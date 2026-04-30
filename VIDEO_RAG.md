# Multimodal Video RAG System Design

## Objective

Build a Retrieval-Augmented Generation (RAG) system that uses a video as the knowledge source. The system should support:

1. Image queries to determine whether a given image appears in the video.
2. Text queries to answer questions about the video content.
3. Future expansion to audio, timestamp search, summaries, and analytics.

---

## High-Level Architecture

```text
Video Input
   ↓
Extract Frames + Audio + OCR
   ↓
Generate Embeddings
   ↓
Store in Vector Database
   ↓
User Query (Image / Text)
   ↓
Generate Query Embedding
   ↓
Similarity Search
   ↓
LLM Generates Final Answer
```

---

## Step 1: Video Ingestion

* Accept video formats such as `.mp4`, `.mov`, `.avi`.
* Store files in local storage or cloud storage.
* Example path: `videos/car_demo.mp4`

---

## Step 2: Extract Frames from Video

Break the video into searchable visual units.

### Recommended Methods

* 1 frame per second
* 1 frame every 2 seconds
* Scene-change detection (recommended)

### Tools

* FFmpeg
* OpenCV

### Example

```bash
ffmpeg -i video.mp4 -vf fps=1 frames/frame_%04d.jpg
```

---

## Step 3: Extract Audio Transcript

Convert speech in the video into searchable text.

### Tools

* Whisper
* Google Speech-to-Text
* Vertex AI Speech APIs

### Example Output

```text
00:00 Hello everyone welcome...
00:05 Today we are reviewing a car...
```

---

## Step 4: OCR from Frames

Detect visible text in frames such as:

* Number plates
* Banners
* Names
* Subtitles
* Product labels

### Tools

* Tesseract OCR
* Google Vision API

---

## Step 5: Generate Embeddings

Create vector embeddings for all modalities.

### A. Image Embeddings

Use models such as:

* CLIP
* Gemini Multimodal Embeddings
* Vertex AI Multimodal Embeddings

### B. Text Embeddings

Use models such as:

* text-embedding-004
* Sentence Transformers
* OpenAI Text Embeddings

---

## Step 6: Store in Vector Database

### Recommended Databases

* PostgreSQL + PGVector
* Pinecone
* Weaviate
* Vertex AI Vector Search

### Example Frame Record

```json
{
  "id": "frame_120",
  "type": "image",
  "timestamp": "00:02:10",
  "embedding": [...],
  "metadata": {
    "frame_path": "frame_120.jpg",
    "video": "car_demo.mp4"
  }
}
```

### Example Transcript Record

```json
{
  "id": "text_22",
  "type": "text",
  "timestamp": "00:03:15",
  "content": "The car reaches top speed of 180 kmph"
}
```

---

## Step 7: Query Flow for Image Input

### Input

User uploads an image.

### Process

1. Generate embedding of uploaded image.
2. Search nearest frame vectors.
3. Compare similarity score with threshold.
4. Return match with timestamp.

### Example Output

* Yes, this image appears in the video at 02:14.
* No similar frame found.

---

## Step 8: Query Flow for Text Questions

### Example Question

“What color was the car?”

### Process

1. Convert question into embedding.
2. Search transcript chunks + image captions + metadata.
3. Retrieve top matches.
4. Send context to LLM.
5. Generate final answer.

### Example Output

“The car shown in the video was red.”

---

## Recommended Technology Stack

### Backend

* Node.js
* Python (preferred for video pipelines)

### Video Processing

* OpenCV
* FFmpeg

### Embeddings

* Gemini
* Vertex AI
* CLIP

### Vector DB

* PGVector (cost-effective)
* Vertex AI Vector Search (enterprise scale)

### LLM Layer

* Gemini 2.5
* GPT
* Claude

---

## Recommended Production Pipeline

```text
Upload Video
↓
Cloud Trigger Starts Processing
↓
Frame Extraction + Transcript + OCR
↓
Embedding Generation
↓
Store in Vector DB
↓
Expose Query API
```

---

## Common Challenges

1. Large videos produce too many frames.
2. False positive image matches.
3. High embedding cost.
4. Weak scene understanding from raw frames.
5. Slow indexing for long videos.

---

## Best Practice (Recommended)

Instead of storing only raw frames, store:

* Frame image embedding
* Frame caption embedding
* OCR text embedding
* Audio transcript embedding
* Timestamp metadata

This significantly improves search accuracy.

---

## Optimized Low-Cost Architecture

```text
Video
→ Scene Detection
→ 1 Key Frame per Scene
→ Generate Caption
→ Store Caption + Embedding
→ Store Transcript Embeddings
→ PGVector Search
```

---

## Example Queries

### Image Query

“Is this logo shown in the video?”

### Text Query

“Did a red car appear in the video?”

### Timestamp Query

“When did the person enter the room?”

---

## Final Recommendation

For best balance of cost, speed, and quality:

* Use Scene Detection instead of every frame.
* Use Gemini for captions.
* Use Whisper for transcript.
* Use PGVector initially.
* Upgrade to Vertex AI Vector Search at scale.
