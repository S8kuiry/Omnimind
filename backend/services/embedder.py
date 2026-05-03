# import requests
# from config import HF_API_TOKEN, HF_EMBEDDING_URL

# HEADERS = {"Authorization": f"Bearer {HF_API_TOKEN}"}

# def _call_hf(texts: list[str]) -> list[list[float]]:
#     """
#     Calls HuggingFace Inference API.
#     Sends a list of strings, gets back a list of vectors.
#     The model (all-MiniLM-L6-v2) runs on HF servers —
#     zero RAM cost on our Render instance.
#     """
#     response = requests.post(
#         HF_EMBEDDING_URL,
#         headers=HEADERS,
#         json={"inputs": texts, "options": {"wait_for_model": True}}
#         # wait_for_model=True handles the cold start automatically
#         # instead of getting a 503, it waits up to 20s for HF to wake the model
#     )
#     response.raise_for_status()
#     return response.json()

# def embed_texts(texts: list[str]) -> list[list[float]]:
#     """
#     Embed a batch of chunks during indexing (Phase A).
#     HF API accepts up to 100 texts per call — we batch if needed.
#     """
#     # batch in groups of 64 to stay within HF limits
#     all_vectors = []
#     batch_size = 64

#     for i in range(0, len(texts), batch_size):
#         batch = texts[i : i + batch_size]
#         vectors = _call_hf(batch)
#         all_vectors.extend(vectors)

#     return all_vectors

# def embed_query(query: str) -> list[float]:
#     """
#     Embed a single user question during retrieval (Phase B).
#     Returns a single vector (list of floats).
#     """
#     result = _call_hf([query])
#     return result[0]  # unwrap the list-of-one


# embedder.py — drop-in replacement, same interface
import requests
from config import GOOGLE_API_KEY

URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={GOOGLE_API_KEY}"

def _embed_one(text: str) -> list[float]:
    res = requests.post(URL, json={
        "content": {"parts": [{"text": text}]}
    })
    res.raise_for_status()
    return res.json()["embedding"]["values"]


def embed_texts(texts: list[str]) -> list[list[float]]:
    return [_embed_one(t) for t in texts]

def embed_query(query: str) -> list[float]:
    return _embed_one(query)