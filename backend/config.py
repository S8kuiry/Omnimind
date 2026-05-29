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

GROQ_MODEL         = "qwen/qwen3-32b"

ALLOWED_MODELS = {
    # Fast / cheap
    "llama-3.1-8b-instant",

    # Strong general-purpose
    "llama-3.3-70b-versatile",
    "qwen/qwen3-32b",

    # Reasoning-focused

    # Open-weight "GPT OSS" (listed as production models in Groq docs)
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
}

CHUNK_SIZE         = int(os.getenv("CHUNK_SIZE", "1000"))
CHUNK_OVERLAP      = int(os.getenv("CHUNK_OVERLAP", "100"))
TOP_K_RESULTS      = 8
# Must match your Pinecone index (Gemini default = 3072). Use 768 only with a 768-dim index + local embeddings.
EMBEDDING_DIMENSION = int(os.getenv("EMBEDDING_DIMENSION", "3072"))