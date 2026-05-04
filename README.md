# NVIDIA NIM API Integration

This project provides a beginner-friendly implementation for integrating the NVIDIA NIM API as a plug-and-play provider.

## Files

- `src/nim_client.py`: The main NIM client class that requires only an API key to operate.
- `example_usage.py`: Example showing how to use the NIMClient.

## Usage

1. Install the required dependency:
   ```bash
   pip install requests
   ```

2. In `example_usage.py` (or your own script), replace `"your-api-key-here"` with your actual NVIDIA NIM API key.

3. Run the example:
   ```bash
   python example_usage.py
   ```

## Features

- Zero configuration: Only requires API key
- Simple `generate()` method for text generation
- Supports both string prompts and chat-format conversations
- Automatic request formatting and error handling
- Type hints for better IDE support
- Comprehensive documentation

## Example Output

When run with a valid API key, the example will output:
- The capital of France (Paris)
- A haiku about autumn leaves

## Note

For production use, consider using environment variables or a secure vault to store your API key instead of hardcoding it.