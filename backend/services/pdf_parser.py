import fitz  # PyMuPDF



"""
    Takes raw PDF bytes, returns a list of page dicts.
    Each dict has: { "page": int, "text": str }
    
    Why page-by-page? So we can store the page number
    as metadata in ChromaDB and cite it in answers.
"""
def extract_text_from_pdf(file_bytes: bytes) -> list[dict]:
    pages = []
    
    # open PDF from bytes (not a file path)
    doc = fitz.open(stream=file_bytes, filetype="pdf")

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text()
        
        # skip empty pages
        if text.strip():
            pages.append({
                "page": page_num + 1,  # 1-indexed for humans
                "text": text.strip()
            })
    
    doc.close()
    return pages


