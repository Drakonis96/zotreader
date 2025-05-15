import asyncio
import os
from fastapi import APIRouter, HTTPException, Request, Header
from typing import List, Dict, Optional
from dotenv import load_dotenv
from pydantic import BaseModel, Field
import redis.asyncio as aioredis
from backend.settings import DOWNLOADS_DIR

try:
    from google import genai
    from google.genai import types
except ImportError:
    import google.generativeai as genai
    from google.generativeai import types

load_dotenv()

router = APIRouter(prefix="/google")

# Redis async client - Keep client definition, but remove usage in google_chat
redis_client = aioredis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))

class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|model)$")
    content: str

class GoogleChatRequest(BaseModel):
    api_key: str | None = None
    model: str
    history: List[dict]  # acepta dicts del frontend

class GoogleProcessPdfRequest(BaseModel):
    api_key: str | None = None
    model: str
    pdf_filename: str
    prompt: str
    history: Optional[List[dict]] = None

@router.post("/chat")
async def google_chat(req: GoogleChatRequest, request: Request, x_session_id: str = Header(None)): # Remove redis_client dependency for this function
    api_key = req.api_key or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="Google API key is required.")
    try:
        # Log API key (partially masked)
        masked_key = f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) > 8 else "<key too short>"
        print(f"[DEBUG] Using Google API Key: {masked_key}")
        print(f"[DEBUG] Using Model: {req.model}")

        # Instantiate the client with the API key
        client = genai.Client(api_key=api_key)

        # Format history for generate_content
        gemini_history = []
        for msg in req.history:
            role = msg.get('role')
            content = msg.get('content')
            if role == "assistant":
                role = "model"
            if not isinstance(content, str):
                content = str(content)
            if role in ("user", "model") and content:
                 gemini_history.append(types.Content(role=role, parts=[types.Part(text=content)]))

        if not gemini_history or gemini_history[-1].role != 'user':
             print("[WARN] History is empty or does not end with user message.")
             # Depending on API requirements, you might need to raise an error here
             # raise HTTPException(status_code=400, detail="Invalid chat history: must end with a user message.")
             pass # Assuming valid history ending with user message for now

        # Log the history being sent
        print(f"[DEBUG] Sending history to Gemini: {gemini_history}")

        # Use the asynchronous client's generate_content method
        response = await client.aio.models.generate_content(
            model=req.model,
            contents=gemini_history
        )

        # Log the raw response received
        print(f"[DEBUG] Received raw response from Gemini: {response}")

        # Check for blocking reasons first
        feedback = getattr(response, 'prompt_feedback', None)
        block_reason = getattr(feedback, 'block_reason', None)
        if block_reason:
            error_detail = f"Response blocked due to: {block_reason}"
            print(f"[ERROR] Gemini response blocked: {block_reason}")
            raise HTTPException(status_code=400, detail=error_detail)

        # Nueva lógica para extraer la respuesta correctamente
        answer = getattr(response, "text", "").strip()
        if answer:
            print("[DEBUG] Returning response.text.")
            return {"response": answer}
        # Fallback: intenta extraer el texto de la primera candidate
        try:
            answer = response.candidates[0].content.parts[0].text
            print("[DEBUG] Returning response.candidates[0].content.parts[0].text.")
            return {"response": answer}
        except (AttributeError, IndexError):
            print("[ERROR] Gemini devolvió una respuesta vacía.")
            raise HTTPException(status_code=500, detail="Gemini devolvió una respuesta vacía.")

    except Exception as e:
        import traceback
        print(f"[ERROR] Error in google_chat: {e}")
        traceback.print_exc()
        if isinstance(e, AttributeError) and "'GenerateContentResponse' object has no attribute 'parts'" in str(e):
             raise HTTPException(status_code=500, detail="Internal error processing Gemini response structure.")
        else:
             raise HTTPException(status_code=400, detail=f"Gemini chat error: {e}")

@router.post("/process-pdf")
async def google_process_pdf(req: GoogleProcessPdfRequest, request: Request, x_session_id: str = Header(None)):
    api_key = req.api_key or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="Google API key is required.")
    file_path = DOWNLOADS_DIR / req.pdf_filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {req.pdf_filename}")
    session_id = x_session_id or request.client.host
    try:
        client = genai.Client(api_key=api_key)
        contents = []
        if req.history:
            for m in req.history:
                role = "model" if m.get('role') == "assistant" else m.get('role')
                if role not in ("user", "model", "system"):
                    continue
                contents.append(
                    types.Content(role=role, parts=[types.Part(text=m.get('content'))])
                )
        # If sending markdown as plain text
        if req.pdf_filename.lower().endswith('.txt'):
            with open(file_path, 'r', encoding='utf-8') as f:
                md_content = f.read()
            # Wrap in delimiters
            doc_text = f"[DOCUMENTO]\n{md_content}\n[/DOCUMENTO]"
            # Prepend document to prompt
            prompt_part = types.Part(text=f"{doc_text}\n\n{req.prompt}")
            contents.append(types.Content(role="user", parts=[prompt_part]))
        else:
            MAX_DIRECT = 20 * 1024 * 1024  # 20 MB
            pdf_size = file_path.stat().st_size
            HARD_LIMIT = 100 * 1024 * 1024  # 100 MB
            if pdf_size > HARD_LIMIT:
                raise HTTPException(
                    status_code=413,
                    detail=f"PDF demasiado grande (> {HARD_LIMIT//1024//1024} MB)"
                )
            if pdf_size <= MAX_DIRECT:
                pdf_part = types.Part.from_bytes(
                    data=file_path.read_bytes(),
                    mime_type="application/pdf"
                )
            else:
                uploaded = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: client.files.upload(file=str(file_path))
                )
                print("[DEBUG] uploaded:", uploaded)
                file_id = getattr(uploaded, 'file_id', None) or getattr(uploaded, 'name', None)
                if not file_id:
                    raise HTTPException(status_code=500, detail="No file_id or name returned by upload")
                pdf_part = types.Part(file_id=file_id)
            prompt_part = types.Part(text=req.prompt)
            contents.append(
                types.Content(role="user", parts=[pdf_part, prompt_part])
            )
        MAX_TOKENS = 32000
        if hasattr(genai, "count_tokens"):
            num_tokens = genai.count_tokens(contents)
            if num_tokens > MAX_TOKENS and len(contents) > 1:
                # recorta solo el historial previo
                while num_tokens > MAX_TOKENS and len(contents) > 1:
                    contents.pop(0)
                    num_tokens = genai.count_tokens(contents)
        response = await client.aio.models.generate_content(
            model=req.model,
            contents=contents
        )
        return {"response": response.text}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gemini PDF processing error: {e}")

@router.get("/list-local-pdfs", response_model=List[str])
def list_local_pdfs() -> List[str]:
    return [f.name for f in DOWNLOADS_DIR.glob("*.pdf") if f.is_file()]
