"""
Pankha Mock Agents - Shared Logger

Single rotating log file for all agents in the swarm.
"""

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

# Global logger instance
_logger: Optional[logging.Logger] = None


def setup_logger(log_dir: Path, debug: bool = False) -> logging.Logger:
    """Configure shared rotating logger for all agents."""
    global _logger
    
    if _logger is not None:
        return _logger
    
    log_file = log_dir / "swarm.log"
    log_dir.mkdir(parents=True, exist_ok=True)
    
    # Create logger
    logger = logging.getLogger("mock-agents")
    logger.setLevel(logging.DEBUG if debug else logging.INFO)
    
    # Clear any existing handlers
    logger.handlers.clear()
    
    # File handler - rotating, 5MB max, 2 backups
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=5_000_000,
        backupCount=2,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(
        '[%(asctime)s] [%(levelname)-8s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    logger.addHandler(file_handler)
    
    # Console handler - INFO+ only (less verbose)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(logging.Formatter(
        '[%(levelname)s] %(message)s'
    ))
    logger.addHandler(console_handler)
    
    _logger = logger
    return logger


def get_logger() -> logging.Logger:
    """Get the shared logger instance."""
    global _logger
    if _logger is None:
        # Fallback to basic config if not initialized
        logging.basicConfig(level=logging.INFO)
        return logging.getLogger("mock-agents")
    return _logger
