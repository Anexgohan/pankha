import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import Database from '../database/database';
import { FanControlCommand } from '../types/agent';
import { AgentManager } from './AgentManager';
import { log } from '../utils/logger';

interface PendingCommand {
  command: FanControlCommand;
  timestamp: Date;
  retries: number;
  timeout?: NodeJS.Timeout;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

interface CommandQueueItem {
  command: FanControlCommand;
  priority: number;
  timestamp: Date;
}

export class CommandDispatcher extends EventEmitter {
  private static instance: CommandDispatcher;
  private db: Database;
  private agentManager: AgentManager;
  private webSocketHub: any; // Will be set via setWebSocketHub
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private commandQueues: Map<string, CommandQueueItem[]> = new Map(); // Per-agent command queues
  private maxRetries = 3;
  private commandTimeout = 10000; // 10 seconds
  private queueProcessingInterval: NodeJS.Timeout | null = null;
  private rateLimitDelay = 100; // 100ms between commands to same agent

  private constructor() {
    super();
    this.db = Database.getInstance();
    this.agentManager = AgentManager.getInstance();
    
    this.startQueueProcessing();
  }

  /**
   * Set WebSocketHub reference for sending commands
   */
  public setWebSocketHub(webSocketHub: any): void {
    this.webSocketHub = webSocketHub;
  }

  public static getInstance(): CommandDispatcher {
    if (!CommandDispatcher.instance) {
      CommandDispatcher.instance = new CommandDispatcher();
    }
    return CommandDispatcher.instance;
  }


  /**
   * Send a fan control command to an agent
   */
  public async sendCommand(
    agentId: string, 
    type: FanControlCommand['type'], 
    payload: FanControlCommand['payload'],
    priority: FanControlCommand['priority'] = 'normal'
  ): Promise<any> {
    const command: FanControlCommand = {
      commandId: uuidv4(),
      agentId,
      type,
      payload,
      timestamp: Date.now(),
      priority
    };

    return new Promise((resolve, reject) => {
      // Add to queue with priority
      this.addToQueue(command, resolve, reject);
      
      log.info(` Command queued for agent ${agentId}: ${type} (Priority: ${priority})`, 'CommandDispatcher');
    });
  }

  /**
   * Set fan speed for a specific fan
   */
  public async setFanSpeed(agentId: string, fanId: string, speed: number, priority: 'low' | 'normal' | 'high' | 'emergency' = 'normal'): Promise<any> {
    // Validate speed range
    if (speed < 0 || speed > 100) {
      throw new Error('Fan speed must be between 0 and 100');
    }

    // Get fan limits from database
    const fan = await this.db.get(
      'SELECT min_speed, max_speed, is_controllable FROM fans f JOIN systems s ON f.system_id = s.id WHERE s.agent_id = $1 AND f.fan_name = $2',
      [agentId, fanId]
    );

    if (!fan) {
      throw new Error(`Fan ${fanId} not found for agent ${agentId}`);
    }

    if (!fan.is_controllable) {
      throw new Error(`Fan ${fanId} is not controllable`);
    }

    // Apply safety limits
    const safeSpeed = Math.max(fan.min_speed || 0, Math.min(speed, fan.max_speed || 100));
    
    if (safeSpeed !== speed) {
      log.warn(`⚠️  Fan speed adjusted for safety: ${speed}% -> ${safeSpeed}% for fan ${fanId}`, 'CommandDispatcher');
    }

    return this.sendCommand(agentId, 'setFanSpeed', { fanId, speed: safeSpeed }, priority);
  }

  /**
   * Set update interval for an agent
   */
  public async setUpdateInterval(agentId: string, interval: number, priority: 'low' | 'normal' | 'high' | 'emergency' = 'normal'): Promise<any> {
    // Validate interval range (0.5-30 seconds)
    if (interval < 0.5 || interval > 30) {
      throw new Error('Update interval must be between 0.5 and 30 seconds');
    }

    log.info(` Setting update interval for agent ${agentId}: ${interval}s`, 'CommandDispatcher');

    return this.sendCommand(agentId, 'setUpdateInterval', { interval }, priority);
  }

  /**
   * Set sensor deduplication
   */
  public async setSensorDeduplication(agentId: string, enabled: boolean, priority: 'low' | 'normal' | 'high' | 'emergency' = 'normal'): Promise<any> {
    log.info(` Setting sensor deduplication for agent ${agentId}: ${enabled}`, 'CommandDispatcher');

    return this.sendCommand(agentId, 'setSensorDeduplication', { enabled }, priority);
  }

  /**
   * Set sensor tolerance
   */
  public async setSensorTolerance(agentId: string, tolerance: number, priority: 'low' | 'normal' | 'high' | 'emergency' = 'normal'): Promise<any> {
    // Validate tolerance range (0.25-5.0°C)
    if (tolerance < 0.25 || tolerance > 5.0) {
      throw new Error('Sensor tolerance must be between 0.25 and 5.0°C');
    }

    log.info(` Setting sensor tolerance for agent ${agentId}: ${tolerance}°C`, 'CommandDispatcher');

    return this.sendCommand(agentId, 'setSensorTolerance', { tolerance }, priority);
  }

  /**
   * Apply a fan profile to a system
   */
  public async applyFanProfile(agentId: string, profileName: string): Promise<any> {
    // Get profile from database
    const profile = await this.db.get(
      'SELECT profile_data FROM fan_profiles fp JOIN systems s ON fp.system_id = s.id WHERE s.agent_id = $1 AND fp.profile_name = $2',
      [agentId, profileName]
    );

    if (!profile) {
      throw new Error(`Fan profile '${profileName}' not found for agent ${agentId}`);
    }

    return this.sendCommand(agentId, 'setProfile', { profileName }, 'normal');
  }

  /**
   * Emergency stop - set all fans to maximum speed
   */
  public async emergencyStop(agentId: string): Promise<any> {
    log.warn(` Emergency stop triggered for agent ${agentId}`, 'CommandDispatcher');
    return this.sendCommand(agentId, 'emergencyStop', {}, 'emergency');
  }

  /**
   * Emergency stop for all agents
   */
  public async emergencyStopAll(): Promise<void> {
    log.warn(' Emergency stop triggered for ALL agents', 'CommandDispatcher');
    
    const agents = this.agentManager.getAgents();
    const promises = agents.map(agent => this.emergencyStop(agent.agentId));
    
    try {
      await Promise.all(promises);
      log.info(' Emergency stop completed for all agents', 'CommandDispatcher');
    } catch (error) {
      log.error(' Error during emergency stop:', 'CommandDispatcher', error);
    }
  }

  /**
   * Get system status from agent
   */
  public async getSystemStatus(agentId: string): Promise<any> {
    return this.sendCommand(agentId, 'getStatus', {}, 'normal');
  }

  /**
   * Update sensor mapping for fans
   */
  public async updateSensorMapping(agentId: string, mappings: Array<{
    fanId: string;
    primarySensorId: string;
    secondarySensorId?: string;
    logic: 'max' | 'avg' | 'primary_only';
  }>): Promise<any> {
    return this.sendCommand(agentId, 'updateSensorMapping', { sensorMappings: mappings }, 'normal');
  }

  /**
   * Rescan sensors on an agent
   */
  public async rescanSensors(agentId: string): Promise<any> {
    return this.sendCommand(agentId, 'rescanSensors', {}, 'normal');
  }

  /**
   * Add command to queue
   */
  private addToQueue(command: FanControlCommand, resolve: (value: any) => void, reject: (error: any) => void): void {
    const { agentId } = command;
    
    if (!this.commandQueues.has(agentId)) {
      this.commandQueues.set(agentId, []);
    }

    const queue = this.commandQueues.get(agentId)!;
    
    // Priority mapping for sorting
    const priorityValues = { emergency: 4, high: 3, normal: 2, low: 1 };
    const priorityValue = priorityValues[command.priority];

    const queueItem: CommandQueueItem = {
      command,
      priority: priorityValue,
      timestamp: new Date()
    };

    // Insert in priority order
    let inserted = false;
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].priority < priorityValue) {
        queue.splice(i, 0, queueItem);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      queue.push(queueItem);
    }

    // Store pending command for response handling
    const pendingCommand: PendingCommand = {
      command,
      timestamp: new Date(),
      retries: 0,
      resolve,
      reject
    };

    this.pendingCommands.set(command.commandId, pendingCommand);

    // Set timeout
    pendingCommand.timeout = setTimeout(() => {
      this.handleCommandTimeout(command.commandId);
    }, this.commandTimeout);
  }

  /**
   * Process command queues
   */
  private startQueueProcessing(): void {
    this.queueProcessingInterval = setInterval(() => {
      this.processQueues();
    }, this.rateLimitDelay);
  }

  /**
   * Process all agent queues
   */
  private async processQueues(): Promise<void> {
    for (const [agentId, queue] of this.commandQueues.entries()) {
      if (queue.length > 0) {
        const queueItem = queue.shift()!;
        await this.executeCommand(queueItem.command);
      }
    }
  }

  /**
   * Execute a command
   */
  private async executeCommand(command: FanControlCommand): Promise<void> {
    try {
      if (!this.webSocketHub) {
        throw new Error('WebSocketHub not set');
      }

      const success = this.webSocketHub.sendCommandToAgent(command.agentId, command);
      
      if (!success) {
        throw new Error('Failed to send command to agent');
      }

      // Log command execution
      await this.logCommand(command, 'sent');
      
    } catch (error) {
      console.error(`Error executing command ${command.commandId}:`, error);
      this.handleCommandError(command.commandId, error);
    }
  }

  /**
   * Handle command response from agent
   */
  private handleCommandResponse(event: { agentId: string; response: any }): void {
    const { response } = event;
    const commandId = response.commandId;
    
    const pendingCommand = this.pendingCommands.get(commandId);
    if (!pendingCommand) {
      log.warn(`Received response for unknown command: ${commandId}`, 'CommandDispatcher');
      return;
    }

    // Clear timeout
    if (pendingCommand.timeout) {
      clearTimeout(pendingCommand.timeout);
    }

    // Remove from pending commands
    this.pendingCommands.delete(commandId);

    // Log response
    this.logCommand(pendingCommand.command, response.success ? 'completed' : 'failed', response);

    if (response.success) {
      log.info(` Command completed: ${pendingCommand.command.type} (${commandId})`, 'CommandDispatcher');

      // Update AgentManager with new values when commands succeed
      if (pendingCommand.command.type === 'setUpdateInterval' && response.data?.interval) {
        this.agentManager.setAgentUpdateInterval(pendingCommand.command.agentId, response.data.interval);
      }
      if (pendingCommand.command.type === 'setSensorDeduplication' && response.data?.enabled !== undefined) {
        this.agentManager.setAgentSensorDeduplication(pendingCommand.command.agentId, response.data.enabled);
      }
      if (pendingCommand.command.type === 'setSensorTolerance' && response.data?.tolerance !== undefined) {
        this.agentManager.setAgentSensorTolerance(pendingCommand.command.agentId, response.data.tolerance);
      }
      pendingCommand.resolve(response.data);
      this.emit('commandCompleted', { command: pendingCommand.command, response });
    } else {
      log.error(` Command failed: ${pendingCommand.command.type} (${commandId}) - ${response.error}`, 'CommandDispatcher');
      pendingCommand.reject(new Error(response.error));
      this.emit('commandFailed', { command: pendingCommand.command, error: response.error });
    }
  }

  /**
   * Handle command timeout
   */
  private handleCommandTimeout(commandId: string): void {
    const pendingCommand = this.pendingCommands.get(commandId);
    if (!pendingCommand) return;

    if (pendingCommand.retries < this.maxRetries) {
      // Retry command
      pendingCommand.retries++;
      log.warn(`⏰ Command timeout, retrying (${pendingCommand.retries}/${this.maxRetries}): ${commandId}`, 'CommandDispatcher');
      
      // Re-queue command
      this.addToQueue(pendingCommand.command, pendingCommand.resolve, pendingCommand.reject);
    } else {
      // Max retries reached
      log.error(` Command timeout after ${this.maxRetries} retries: ${commandId}`, 'CommandDispatcher');
      this.pendingCommands.delete(commandId);
      pendingCommand.reject(new Error('Command timeout'));
      this.emit('commandTimeout', { command: pendingCommand.command });
    }
  }

  /**
   * Handle command error
   */
  private handleCommandError(commandId: string, error: any): void {
    const pendingCommand = this.pendingCommands.get(commandId);
    if (!pendingCommand) return;

    if (pendingCommand.timeout) {
      clearTimeout(pendingCommand.timeout);
    }

    this.pendingCommands.delete(commandId);
    pendingCommand.reject(error);
    
    this.logCommand(pendingCommand.command, 'error', error);
    this.emit('commandError', { command: pendingCommand.command, error });
  }

  /**
   * Handle agent disconnection
   */
  private handleAgentDisconnected(agentId: string): void {
    // Fail all pending commands for this agent
    const commandsToFail: string[] = [];
    
    for (const [commandId, pendingCommand] of this.pendingCommands.entries()) {
      if (pendingCommand.command.agentId === agentId) {
        commandsToFail.push(commandId);
      }
    }

    for (const commandId of commandsToFail) {
      this.handleCommandError(commandId, new Error('Agent disconnected'));
    }

    // Clear queue for this agent
    this.commandQueues.delete(agentId);
    
    log.warn(` Agent ${agentId} disconnected, ${commandsToFail.length} commands failed`, 'CommandDispatcher');
  }

  /**
   * Log command for auditing
   */
  private async logCommand(command: FanControlCommand, status: string, details?: any): Promise<void> {
    try {
      // This could be stored in a separate audit table if needed
      console.log(` Command log: ${command.type} (${command.commandId}) - ${status}`, 
        details ? JSON.stringify(details) : '');
    } catch (error) {
      log.error('Error logging command:', 'CommandDispatcher', error);
    }
  }

  /**
   * Get pending commands count
   */
  public getPendingCommandsCount(): number {
    return this.pendingCommands.size;
  }

  /**
   * Get queue status for all agents
   */
  public getQueueStatus(): { [agentId: string]: number } {
    const status: { [agentId: string]: number } = {};
    
    for (const [agentId, queue] of this.commandQueues.entries()) {
      status[agentId] = queue.length;
    }
    
    return status;
  }

  /**
   * Clear all pending commands for an agent
   */
  public clearAgentCommands(agentId: string): void {
    const commandsToFail: string[] = [];
    
    for (const [commandId, pendingCommand] of this.pendingCommands.entries()) {
      if (pendingCommand.command.agentId === agentId) {
        commandsToFail.push(commandId);
      }
    }

    for (const commandId of commandsToFail) {
      this.handleCommandError(commandId, new Error('Commands cleared'));
    }

    this.commandQueues.delete(agentId);
    log.info(` Cleared ${commandsToFail.length} commands for agent ${agentId}`, 'CommandDispatcher');
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    if (this.queueProcessingInterval) {
      clearInterval(this.queueProcessingInterval);
    }
    
    // Clear all timeouts
    for (const pendingCommand of this.pendingCommands.values()) {
      if (pendingCommand.timeout) {
        clearTimeout(pendingCommand.timeout);
      }
    }
    
    this.pendingCommands.clear();
    this.commandQueues.clear();
    this.removeAllListeners();
  }
}