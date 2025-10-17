# Pankha Documentation

Welcome to the Pankha distributed fan control system documentation. This directory contains comprehensive guides for understanding, deploying, and using Pankha across different environments.

## Documentation Structure

### 📋 **Core Documentation**

#### **[ARCHITECTURE.md](./ARCHITECTURE.md)**
Complete system architecture overview including:
- System components and their relationships
- Data flow diagrams and communication protocols
- Deployment architecture for production and development
- Scalability considerations and security guidelines

#### **[AGENT-DEPLOYMENT.md](./AGENT-DEPLOYMENT.md)**
Agent deployment and management guide covering:
- Installation procedures for Linux and Windows
- Configuration files and hardware setup
- Service management and troubleshooting
- Communication flow between agents and backend

#### **[USER-WORKFLOWS.md](./USER-WORKFLOWS.md)**
User interaction workflows and interface guide including:
- Common user scenarios and step-by-step procedures
- Web interface components and features
- Advanced user features and automation
- Troubleshooting and support information

### 🚀 **Quick Start Guides**

#### **[backend/build-instructions.md](./backend/build-instructions.md)**
Backend development and deployment:
- Local development setup
- Docker containerization
- Production deployment procedures

#### **[client/setup-guide.md](./client/setup-guide.md)**
Client (agent) installation guide:
- Hardware requirements and compatibility
- Step-by-step installation procedures
- Configuration examples and templates

### 📊 **Quick Start**

#### **[quick-start/PROJECT-STATUS.md](../quick-start/PROJECT-STATUS.md)**
Current project status and deployment details:
- Implementation progress tracking
- Directory structure and deployment workflow
- Infrastructure setup and configuration

#### **[quick-start/PROJECT-OVERVIEW.md](../quick-start/PROJECT-OVERVIEW.md)**
Project outline and specifications:
- Feature requirements and specifications
- System design decisions
- Implementation roadmap

### 📋 **Guides**

#### **[guides/TESTING-GUIDE.md](../guides/TESTING-GUIDE.md)**
Comprehensive testing procedures:
- Testing framework setup
- Integration testing procedures
- Performance and reliability testing

### 📝 **Task Documentation**

#### **[tasks-todo/task_01.md](./tasks-todo/task_01.md)**
Task 01 completion documentation:
- Detailed implementation notes
- Testing procedures and validation
- Acceptance criteria verification

## Getting Started

### For System Administrators
1. Start with **[ARCHITECTURE.md](./ARCHITECTURE.md)** to understand the system design
2. Follow **[backend/build-instructions.md](./backend/build-instructions.md)** to deploy the backend
3. Use **[AGENT-DEPLOYMENT.md](./AGENT-DEPLOYMENT.md)** to install agents on target systems

### For End Users
1. Review **[USER-WORKFLOWS.md](./USER-WORKFLOWS.md)** for interface usage
2. Access the web interface at your deployment URL
3. Follow the workflow guides for common tasks

### For Developers
1. Read **[ARCHITECTURE.md](./ARCHITECTURE.md)** for system understanding
2. Check **[PROGRESS.md](./PROGRESS.md)** for current implementation status
3. Review task documentation for implementation details

## System Overview

Pankha is a distributed fan control system consisting of:

- **Central Backend**: Docker-containerized Node.js/TypeScript server with PostgreSQL database
- **Distributed Agents**: Python-based hardware monitoring agents deployable on any system
- **Web Frontend**: React-based user interface for monitoring and control

### Key Features
- ✅ Real-time temperature monitoring across multiple systems
- ✅ Centralized fan control with custom profiles
- ✅ WebSocket-based real-time communication
- ✅ Safety mechanisms and emergency controls
- ✅ Scalable architecture supporting unlimited agents
- ✅ Web-based management interface

### Current Deployment
- **Backend**: http://192.168.100.237:3000 (Production Docker)
- **Development**: Linux server at 192.168.100.237 (/root/anex/dev/pankha-dev)
- **Test Agent**: Mock agent successfully connected and operational

## Documentation Standards

### File Naming Convention
- `README.md` - Directory overview and navigation
- `ARCHITECTURE.md` - System architecture and design
- `[COMPONENT]-[PURPOSE].md` - Specific component documentation
- Task files: `task_[number].md`

### Content Structure
Each documentation file follows this structure:
1. **Overview** - Purpose and scope
2. **Main Content** - Detailed information organized by sections
3. **Examples** - Code samples, configurations, or procedures
4. **Troubleshooting** - Common issues and solutions
5. **References** - Related documentation and external resources

### Maintenance
Documentation is maintained alongside code changes:
- Update documentation when features are added or modified
- Keep examples and configurations current
- Regular review for accuracy and completeness

## Support and Contributing

### Getting Help
- Review troubleshooting sections in relevant documentation
- Check system logs and diagnostic tools
- Consult the architecture documentation for system understanding

### Contributing to Documentation
- Follow the established structure and naming conventions
- Include practical examples and use cases
- Update related documentation when making changes
- Test procedures and configurations before documenting

---

*This documentation provides comprehensive guidance for deploying, managing, and using the Pankha distributed fan control system across diverse hardware environments.*