# openai_api.py
"""
Módulo para interactuar con la API de OpenAI usando el SDK oficial.
Requiere instalar openai >= 1.0.0: pip install openai
"""
import asyncio
import os
from fastapi import APIRouter, HTTPException, Request, Header
from typing import List, Dict, Optional
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from backend.settings import DOWNLOADS_DIR
from openai import OpenAI

load_dotenv()

router = APIRouter(prefix="/openai")

class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str

class OpenAIChatRequest(BaseModel):
    api_key: str | None = None
    model: str
    history: List[dict]

class OpenAIProcessPdfRequest(BaseModel):
    api_key: str | None = None
    model: str
    pdf_filename: str
    prompt: str
    history: Optional[List[dict]] = None

@router.post("/chat")
async def openai_chat(req: OpenAIChatRequest, request: Request, x_session_id: str = Header(None)):
    api_key = req.api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="OpenAI API key is required.")
    try:
        client = OpenAI(api_key=api_key)
        messages = []
        for msg in req.history:
            role = msg.get('role')
            content = msg.get('content')
            if role not in ("user", "assistant", "system"):
                continue
            messages.append({"role": role, "content": content})
        if not messages or messages[-1]["role"] != "user":
            raise HTTPException(status_code=400, detail="History must end with a user message.")
        response = await asyncio.to_thread(
            lambda: client.chat.completions.create(
                model=req.model,
                messages=messages
            )
        )
        reply = response.choices[0].message.content
        return {"response": reply}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OpenAI chat error: {e}")

@router.post("/process-pdf")
async def openai_process_pdf(req: OpenAIProcessPdfRequest, request: Request, x_session_id: str = Header(None)):
    api_key = req.api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="OpenAI API key is required.")
    pdf_path = DOWNLOADS_DIR / req.pdf_filename
    if not pdf_path.is_file():
        raise HTTPException(status_code=404, detail=f"PDF not found: {req.pdf_filename}")
    try:
        client = OpenAI(api_key=api_key)
        messages = []
        if req.history:
            for m in req.history:
                role = m.get('role')
                if role not in ("user", "assistant", "system"):
                    continue
                messages.append({"role": role, "content": m.get('content')})
        # Adjunta el PDF y el prompt como parte del último mensaje del usuario
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
        import base64
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
            "content": [pdf_content, prompt_content]
        })
        response = await asyncio.to_thread(
            lambda: client.chat.completions.create(
                model=req.model,
                messages=messages
            )
        )
        reply = response.choices[0].message.content
        return {"response": reply}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OpenAI PDF processing error: {e}")

@router.get("/list-local-pdfs", response_model=List[str])
def list_local_pdfs() -> List[str]:
    return [f.name for f in DOWNLOADS_DIR.glob("*.pdf") if f.is_file()]
