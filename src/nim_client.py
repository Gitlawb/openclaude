import requests
import json
from typing import Dict, Any, Optional, Union, List
from dataclasses import dataclass

@dataclass
class NimResponse:
    """Container for NIM API responses"""
    text: str
    usage: Optional[Dict[str, Any]] = None
    model: Optional[str] = None
    finish_reason: Optional[str] = None

class NIMClient:
    """
    A plug-and-play client for NVIDIA NIM API that requires only an API key.
    
    Usage:
        client = NIMClient(api_key="your-api-key-here")
        response = client.generate("Hello, world!")
        print(response.text)
    """
    
    def __init__(self, api_key: str, model: str = "nim/llama3-8b-instruct"):
        """
        Initialize the NIM client.
        
        Args:
            api_key: Your NVIDIA NIM API key
            model: The model to use (default: nim/llama3-8b-instruct)
        """
        self.api_key = api_key
        self.model = model
        # Base URL is hardcoded for simplicity - no configuration needed
        self.base_url = "https://integrate.api.nvidia.com/v1"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
    
    def generate(
        self, 
        prompt: Union[str, List[Dict[str, str]]], 
        max_tokens: int = 100,
        temperature: float = 0.7,
        top_p: float = 1.0,
        stream: bool = False
    ) -> NimResponse:
        """
        Generate text using the NIM API.
        
        Args:
            prompt: The input prompt (string or chat format)
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature (0.0 to 1.0)
            top_p: Nucleus sampling parameter
            stream: Whether to stream the response
            
        Returns:
            NimResponse object containing the generated text
        """
        # Handle both string and chat format prompts
        if isinstance(prompt, str):
            messages = [{"role": "user", "content": prompt}]
        else:
            messages = prompt
            
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "stream": stream
        }
        
        try:
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json=payload,
                timeout=30
            )
            response.raise_for_status()
            
            result = response.json()
            
            return NimResponse(
                text=result["choices"][0]["message"]["content"],
                usage=result.get("usage"),
                model=result.get("model"),
                finish_reason=result["choices"][0].get("finish_reason")
            )
        except requests.exceptions.RequestException as e:
            raise Exception(f"NIM API request failed: {str(e)}")
        except (KeyError, IndexError) as e:
            raise Exception(f"Failed to parse NIM API response: {str(e)}")

# Example usage (uncomment to test)
# if __name__ == "__main__":
#     # Replace with your actual API key
#     client = NIMClient(api_key="your-api-key-here")
#     response = client.generate("Explain quantum computing in simple terms.")
#     print(response.text)