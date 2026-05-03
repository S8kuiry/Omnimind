from langchain_text_splitters   import RecursiveCharacterTextSplitter
from config import CHUNK_SIZE, CHUNK_OVERLAP
 
def chunk_pages(pages: list[dict]) -> list[dict]: 
    """
    Takes list of page dicts from pdf_parser.
    Returns list of chunk dicts with metadata preserved.
    
    Each chunk dict: { "text": str, "page": int, "chunk_id": str }
    
    Why RecursiveCharacterTextSplitter?
    It tries to split on paragraphs first, then sentences,
    then words — so chunks stay semantically meaningful.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ".", " ", ""]
    )
    
    all_chunks = []
    
    for page_data in pages:
        page_num = page_data["page"]
        raw_text = page_data["text"]
        
        # split this page's text into chunks
        text_chunks = splitter.split_text(raw_text)
        
        for i, chunk_text in enumerate(text_chunks):
            all_chunks.append({
                "text": chunk_text,
                "page": page_num,
                # unique id per chunk — used by ChromaDB
                "chunk_id": f"page{page_num}_chunk{i}"
            })
    
    return all_chunks