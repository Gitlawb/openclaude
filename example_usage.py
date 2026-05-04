from nim_client import NIMClient

# Initialize with your API key - ONLY line you need to modify
client = NIMClient(api_key="your-api-key-here")

# Generate text
response = client.generate("What is the capital of France?")
print(response.text)

# Advanced usage with parameters
response = client.generate(
    prompt="Write a haiku about autumn leaves",
    max_tokens=50,
    temperature=0.8
)
print(response.text)