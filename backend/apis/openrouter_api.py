import asyncio
import os
from fastapi import APIRouter, HTTPException, Request, Header
from typing import List, Dict, Optional
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from backend.settings import DOWNLOADS_DIR
import requests
import base64

load_dotenv()

router = APIRouter(prefix="/openrouter")

class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str

class OpenRouterChatRequest(BaseModel):
    api_key: str | None = None
    model: str
    history: List[dict]

class OpenRouterProcessPdfRequest(BaseModel):
    api_key: str | None = None
    model: str
    pdf_filename: str
    prompt: str
    history: Optional[List[dict]] = None

@router.post("/chat")
async def openrouter_chat(req: OpenRouterChatRequest, request: Request, x_session_id: str = Header(None)):
    api_key = req.api_key or os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="OpenRouter API key is required.")
    try:
        messages = []
        for msg in req.history:
            role = msg.get('role')
            content = msg.get('content')
            if role not in ("user", "assistant", "system"):
                continue
            messages.append({"role": role, "content": content})
        if not messages or messages[-1]["role"] != "user":
            raise HTTPException(status_code=400, detail="History must end with a user message.")
        payload = {
            "model": req.model,
            "messages": messages
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=60
        )
        if not response.ok:
            raise HTTPException(status_code=response.status_code, detail=response.text)
        data = response.json()
        reply = data["choices"][0]["message"]["content"]
        return {"response": reply}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OpenRouter chat error: {e}")

@router.post("/process-pdf")
async def openrouter_process_pdf(req: OpenRouterProcessPdfRequest, request: Request, x_session_id: str = Header(None)):
    api_key = req.api_key or os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="OpenRouter API key is required.")
    file_path = DOWNLOADS_DIR / req.pdf_filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {req.pdf_filename}")
    try:
        messages = []
        if req.history:
            for m in req.history:
                role = m.get('role')
                if role not in ("user", "assistant", "system"):
                    continue
                messages.append({"role": role, "content": m.get('content')})
        if req.pdf_filename.lower().endswith('.txt'):
            # Read markdown as plain text and wrap in delimiters
            with open(file_path, "r", encoding="utf-8") as f:
                md_content = f.read()
            doc_text = f"[DOCUMENTO]\n{md_content}\n[/DOCUMENTO]"
            prompt_content = {"type": "text", "text": f"{doc_text}\n\n{req.prompt}"}
            messages.append({
                "role": "user",
                "content": [prompt_content]
            })
        else:
            with open(file_path, "rb") as f:
                pdf_bytes = f.read()
            base64_pdf = base64.b64encode(pdf_bytes).decode("utf-8")
            pdf_content = {
                "type": "file",
                "file": {
                    "filename": req.pdf_filename,
                    "file_data": f"data:application/pdf;base64,{base64_pdf}"
                }
            }
            prompt_content = {"type": "text", "text": req.prompt}
            messages.append({
                "role": "user",
                "content": [prompt_content, pdf_content]
            })
        payload = {
            "model": req.model,
            "messages": messages
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=120
        )
        if not response.ok:
            raise HTTPException(status_code=response.status_code, detail=response.text)
        data = response.json()
        reply = data["choices"][0]["message"]["content"]
        return {"response": reply}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OpenRouter PDF processing error: {e}")

@router.get("/list-local-pdfs", response_model=List[str])
def list_local_pdfs() -> List[str]:
    return [f.name for f in DOWNLOADS_DIR.glob("*.pdf") if f.is_file()]
