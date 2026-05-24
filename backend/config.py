import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY       = os.getenv("GROQ_API_KEY")
HF_API_TOKEN       = os.getenv("HF_API_TOKEN")

# CHROMA_HOST        = os.getenv("CHROMA_HOST", "chromadb")
# CHROMA_PORT        = int(os.getenv("CHROMA_PORT", 8000))

# HuggingFace Inference API endpoint for embeddings
# same model, runs on their servers, zero RAM on ours
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
PINECONE_API_KEY    = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "documents")
PINECONE_CLOUD      = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION     = os.getenv("PINECONE_REGION", "us-east-1")

HF_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
HF_EMBEDDING_URL   = f"https://api-inference.huggingface.co/models/{HF_EMBEDDING_MODEL}"

GROQ_MODEL         = "llama-3.1-8b-instant"

ALLOWED_MODELS = {
    "llama-3.1-8b-instant",
    "qwen/qwen3-32b",
    "allam-2-7b",
    "openai/gpt-oss-120b",
}

CHUNK_SIZE         = 500
CHUNK_OVERLAP      = 50
TOP_K_RESULTS      = 8