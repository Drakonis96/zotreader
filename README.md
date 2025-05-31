<!-- Centered logo at the top -->
<p align="center">
  <img src="frontend/public/logo.png" alt="ZotReader Logo" width="180"/>
</p>

# ZotReader 📚🤖

ZotReader is a modern web application designed to help you read, annotate, and interact with your PDF documents using powerful AI tools—all from your browser! Whether you're a student, researcher, or just love reading, ZotReader makes it easy to highlight, take notes, and chat with AI about your documents in real time.

<!-- DISCLAIMER: This application is not affiliated with or endorsed by Zotero or its parent company. ZotReader is an independent project developed solely to help users view and annotate documents linked to their Zotero library and a WebDAV server through the browser. We have no connection or association with the official Zotero software or organization. -->

> **Important Notice:**
>
> ZotReader is **not intended to replace the official Zotero application**. Rather than being a substitute (which it is not), ZotReader should be considered a companion app that offers AI-powered features and works from any device with a browser. It is designed to complement your Zotero workflow, not to replace it.
>
> **Note:** Annotations and notes made in ZotReader are **not synchronized with Zotero**. The way annotations are handled in ZotReader is different from Zotero's native system.

> **First-time startup notice:**
>
> The first time you start ZotReader, it may take a bit longer to load. This is because the app needs to synchronize your Zotero library structure for the first time. Subsequent startups will be much faster.

---

## 🚀 Main Features
- **Read and Annotate PDFs:** Highlight, underline, and add notes directly in your browser. Compatible with Apple Pencil and other styluses for a natural writing experience.
- **AI-Powered Assistance:** Ask questions, summarize, or get explanations from your documents using integrated AI (supports Gemini, OpenRouter, OpenAI, and more).
- **Seamless Experience:** Use the app from any device—desktop, tablet, or mobile.
- **Easy Document Management:** Upload, organize, and access your PDFs anytime.
- **Beta Notice:** ZotReader is currently in beta. You may encounter bugs or unexpected results. Your feedback is welcome!

## 💡 Recommended AI APIs
We highly recommend using **free AI APIs** like Gemini and OpenRouter, which offer generous free usage while ZotReader is in beta. OpenAI is also supported.

---

# 🛠️ Getting Started

## Option 1: Run with Docker Compose (Recommended) 🐳
1. **Install Docker Desktop** if you haven't already: [Download Docker](https://www.docker.com/products/docker-desktop/)
2. **Clone this repository:**
   ```bash
   git clone https://github.com/Drakonis96/zotreader
   cd ZotReader
   ```
3. **Configure environment variables:**
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - You can open the `.env` file with your favorite editor, for example:
     ```bash
     code .env
     ```
     Or on macOS you can also use:
     ```bash
     open .env
     ```
   - Open the `.env` file in your favorite editor and fill in the required API keys:
     - `OPENAI_API_KEY` (optional, for OpenAI)
     - `GEMINI_API_KEY` (recommended, for Gemini)
     - `OPENROUTER_API_KEY` (recommended, for OpenRouter)
     - `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD` (optional, for cloud storage integration, e.g., Koofr)
     - Any other variables as needed for your setup
   - Example:
     ```env
     OPENAI_API_KEY=sk-...
     GEMINI_API_KEY=your-gemini-key-here
     OPENROUTER_API_KEY=your-openrouter-key-here
     # Example Koofr WebDAV configuration
     WEBDAV_URL=https://app.koofr.net/dav/USERNAME@koofr.net/
     WEBDAV_USERNAME=USERNAME@koofr.net
     WEBDAV_PASSWORD=your-koofr-app-password
     ```
   - We recommend using Gemini or OpenRouter for free usage during beta.
4. **Start the app:**
   ```bash
   docker-compose up --build
   ```
5. **Access the app:**
   - Open your browser and go to [http://localhost:8006](http://localhost:8006)

> **Note:** Although the backend runs internally on port 8000, the application will be available on the port you have configured in the `docker-compose.yml` file (by default, in this project it is **8006**). Make sure to access the correct URL, for example: http://localhost:8006

## Option 2: Manual Setup (Python Backend + Frontend)

### 1. Backend (Python)
- **Install Python 3.11+ and pip**
- **Install dependencies:**
  ```bash
  cd backend
  pip install -r requirements.txt
  ```
- **Configure environment variables:**
  - Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```
  - You can open the `.env` file with your favorite editor, for example:
    ```bash
    code .env
    ```
    Or on macOS you can also use:
    ```bash
    open .env
    ```
  - Open the `.env` file in your favorite editor and fill in the required API keys:
    - `OPENAI_API_KEY` (optional, for OpenAI)
    - `GEMINI_API_KEY` (recommended, for Gemini)
    - `OPENROUTER_API_KEY` (recommended, for OpenRouter)
    - `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD` (optional, for cloud storage integration, e.g., Koofr)
    - Any other variables as needed for your setup
  - Example:
    ```env
    ZOTERO_USER_ID=your_user_id
    ZOTERO_API_KEY=your_zotero_api_key
    WEBDAV_URL=https://app.koofr.net/dav/Koofr #Koofr provided as example
    WEBDAV_USER=your_webdav_user
    WEBDAV_PASS=your_webdav_pass
    GOOGLE_API_KEY=your_google_api_key
    OPENAI_API_KEY=your_openai_api_key
    OPENROUTER_API_KEY=your_openrouter_api_key
    REDIS_URL=redis://redis:6379/0
    ```
  - We recommend using Gemini or OpenRouter for free usage during beta.
- **Run the backend server:**
  ```bash
  uvicorn main:app --reload --host 0.0.0.0 --port 8000
  ```

### 2. Frontend (Vite + React)
- **Install Node.js (v18+) and npm**
- **Install dependencies:**
  ```bash
  cd frontend
  npm install
  ```
- **Run the frontend:**
  ```bash
  npm run dev
  ```
- **Access the app:**
  - Open your browser and go to the URL: http://localhost:8006

---

## ℹ️ About the REDIS_URL variable

- The `REDIS_URL` environment variable specifies the connection address for a Redis server, which is used as a cache and temporary storage system for the application.
- **Default value:** If you do not define `REDIS_URL` in your `.env` or in `docker-compose.yml`, the backend will automatically use:
  
  ```env
  REDIS_URL=redis://redis:6379/0
  ```
  
  This value connects to a Redis service named `redis` (usually defined in Docker Compose) on port 6379 and database 0.
- **Customization:** You can change this value according to your environment (for example, to use an external Redis, another host, port, database, or credentials).
- If the variable does not exist and the code does not find a default value, the application will throw an error when trying to connect to Redis.

---

# ⚠️ Beta Disclaimer
ZotReader is in **beta**. You may experience bugs or unexpected results. Please use free AI APIs (Gemini, OpenRouter) to avoid unnecessary costs during this period. Your feedback is appreciated!

# 🌐 Browser-Based & Pencil Friendly
- Designed for use in your browser—no installation required on your device.
- Fully compatible with Apple Pencil and other styluses for smooth annotation.
- Use AI chat while reading and highlighting your documents, from any device!

---

# 🙏 Acknowledgments

This app was created with the help of advanced AI models from OpenAI (GPT-4.1 and O4), Anthropic (Claude 3.7), and Google (Gemini 2.5 Pro Preview). Any contributions or suggestions to improve the project are very welcome!

Enjoy smarter reading and annotating with ZotReader! ✨

---

## 📸 Screenshots

<p align="center">
  <img src="screenshots/Screenshot 1.png" alt="Screenshot 1" width="600"/>
  <br/>
  <img src="screenshots/Screenshot 2.png" alt="Screenshot 2" width="600"/>
  <br/>
  <img src="screenshots/Screenshot 3.png" alt="Screenshot 3" width="600"/>
</p>
