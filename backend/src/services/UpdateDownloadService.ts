import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';
import { log } from '../utils/logger';

export interface UpdateStatus {
  version: string | null;
  timestamp: string | null;
  files: {
    x86_64: boolean;
    aarch64: boolean;
  };
  checksums: {
    [key: string]: string;
  };
}

export class UpdateDownloadService {
  private static instance: UpdateDownloadService;
  private updatesDir: string;
  private statusFile: string;

  private constructor() {
    this.updatesDir = process.env.UPDATES_DIR || path.join(__dirname, '../../data/updates');
    this.statusFile = path.join(this.updatesDir, 'status.json');
    
    // Ensure directory exists
    if (!fs.existsSync(this.updatesDir)) {
      try {
        fs.mkdirSync(this.updatesDir, { recursive: true });
        log.info(`Created updates directory: ${this.updatesDir}`, 'UpdateService');
      } catch (err) {
        log.error(`Failed to create updates directory: ${this.updatesDir}`, 'UpdateService', err);
      }
    }
  }

  public static getInstance(): UpdateDownloadService {
    if (!UpdateDownloadService.instance) {
      UpdateDownloadService.instance = new UpdateDownloadService();
    }
    return UpdateDownloadService.instance;
  }

  /**
   * Returns the current status of the locally cached updates
   */
  public getLocalStatus(): UpdateStatus {
    try {
      if (fs.existsSync(this.statusFile)) {
        const content = fs.readFileSync(this.statusFile, 'utf8');
        return JSON.parse(content);
      }
    } catch (err) {
      log.error('Failed to read update status file', 'UpdateService', err);
    }

    return {
      version: null,
      timestamp: null,
      files: {
        x86_64: this.fileExists('pankha-agent-linux_x86_64'),
        aarch64: this.fileExists('pankha-agent-linux_arm64')
      },
      checksums: {}
    };
  }

  /**
   * Downloads binaries for a specific version from GitHub
   */
  public async downloadVersion(version: string): Promise<boolean> {
    log.info(`Starting manual download of version ${version} to local server...`, 'UpdateService');
    
    // Clean version string (ensure it starts with v for the URL)
    const tag = version.startsWith('v') ? version : `v${version}`;
    const baseUrl = `https://github.com/Anexgohan/pankha/releases/download/${tag}/`;

    const targets = [
      { arch: 'x86_64', filename: 'pankha-agent-linux_x86_64' },
      { arch: 'aarch64', filename: 'pankha-agent-linux_arm64' }
    ];

    try {
      // 1. Download checksums.txt
      const checksumsUrl = `${baseUrl}checksums.txt`;
      const checksumsDest = path.join(this.updatesDir, 'checksums.txt');
      log.info(`Downloading checksums from ${checksumsUrl}...`, 'UpdateService');
      await this.downloadFile(checksumsUrl, checksumsDest);

      // 2. Parse checksums
      const checksumsContent = fs.readFileSync(checksumsDest, 'utf8');
      const checksumMap: { [key: string]: string } = {};
      checksumsContent.split('\n').forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const [hash, filename] = parts;
          checksumMap[filename] = hash;
        }
      });

      // 3. Download and verify binaries
      for (const target of targets) {
        const url = `${baseUrl}${target.filename}`;
        const dest = path.join(this.updatesDir, target.filename);
        
        log.info(`Downloading ${target.arch} binary from ${url}...`, 'UpdateService');
        await this.downloadFile(url, dest);

        // Verify checksum
        const expectedHash = checksumMap[target.filename];
        if (expectedHash) {
          log.info(`Verifying checksum for ${target.filename}...`, 'UpdateService');
          const isValid = await this.verifyChecksum(dest, expectedHash);
          if (!isValid) {
            throw new Error(`Checksum verification failed for ${target.filename}`);
          }
          log.success(`Checksum verified for ${target.filename}`, 'UpdateService');
        } else {
          log.warn(`No checksum found for ${target.filename} in checksums.txt`, 'UpdateService');
        }

        fs.chmodSync(dest, 0o755); // Ensure executable
      }

      // Update status file
      const status: UpdateStatus = {
        version: tag,
        timestamp: new Date().toISOString(),
        files: {
          x86_64: true,
          aarch64: true
        },
        checksums: checksumMap
      };
      fs.writeFileSync(this.statusFile, JSON.stringify(status, null, 2));
      
      log.success(`Successfully downloaded and cached version ${tag} on server.`, 'UpdateService');
      return true;
    } catch (err) {
      log.error(`Failed to download version ${version}`, 'UpdateService', err);
      return false;
    }
  }

  public getBinaryPath(arch: string): string | null {
    const filename = arch === 'x86_64' ? 'pankha-agent-linux_x86_64' : 'pankha-agent-linux_arm64';
    const filePath = path.join(this.updatesDir, filename);
    return fs.existsSync(filePath) ? filePath : null;
  }

  private fileExists(filename: string): boolean {
    return fs.existsSync(path.join(this.updatesDir, filename));
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          // Handle redirect
          const nextUrl = res.headers.location;
          if (!nextUrl) {
            reject(new Error(`Redirect status ${res.statusCode} without location header`));
            return;
          }
          this.downloadFile(nextUrl, dest).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Server returned status code ${res.statusCode} for ${url}`));
          return;
        }

        const file = fs.createWriteStream(dest);
        res.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          fs.unlink(dest, () => {}); // Handle async unlink
          reject(err);
        });
      });

      request.on('error', (err) => {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });

      // Handle request timeout
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Request timed out'));
      });
    });
  }

  /**
   * Verifies the SHA256 checksum of a file
   */
  public async verifyChecksum(filePath: string, expectedHash: string): Promise<boolean> {
    return new Promise((resolve) => {
      const hash = crypto.createHash('sha256');
      const input = fs.createReadStream(filePath);

      input.on('readable', () => {
        const data = input.read();
        if (data) hash.update(data);
        else {
          const actualHash = hash.digest('hex');
          resolve(actualHash === expectedHash);
        }
      });

      input.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Deletes all locally cached agent binaries and resets the status
   */
  public async clearDownloads(): Promise<boolean> {
    log.info('Clearing all locally cached agent binaries...', 'UpdateService');
    try {
      if (fs.existsSync(this.updatesDir)) {
        const files = fs.readdirSync(this.updatesDir);
        for (const file of files) {
          const filePath = path.join(this.updatesDir, file);
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        }
        log.success('All agent binaries cleared successfully.', 'UpdateService');
      }
      
      // Reset status file
      const emptyStatus: UpdateStatus = {
        version: null,
        timestamp: null,
        files: { x86_64: false, aarch64: false },
        checksums: {}
      };
      fs.writeFileSync(this.statusFile, JSON.stringify(emptyStatus, null, 2));
      
      return true;
    } catch (err) {
      log.error('Failed to clear agent downloads', 'UpdateService', err);
      return false;
    }
  }
}

export default UpdateDownloadService;
