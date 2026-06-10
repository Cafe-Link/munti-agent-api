const { processFile, getRagResponse, getCompanyRagResponse, getCompanyRagResponseV2, clearKnowledgeBase } = require('../services/ragAgent');
const gcsService = require('../services/ingestion/gcsService');
const sessionManager = require('../services/sessionManager');

const handleUpload = async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const result = await gcsService.uploadFile(file);

    const processResult = await processFile({
        ...file,
        gcsFileName: result.fileName,
        gcsUrl: result.url
    }, req.authSessionId);

    // Register Knowledge Oracle feature session if authenticated
    if (req.authSessionId) {
      await sessionManager.startFeatureSession(
        req.authSessionId,
        'knowledge_oracle',
        req.authSessionId // Use authSessionId as moduleSessionId for RAG
      );
    }

    res.status(200).json(processResult);
  } catch (err) {
    console.error('Error in handleUpload:', err);
    res.status(500).json({ error: 'Error processing file' });
  }
};

const handleRagChat = async (req, res) => {
  // Extract data. If sent as FormData (with audio), history is a stringified JSON.
  let message = req.body.message;
  let history = req.body.history;
  
  if (typeof history === 'string') {
    try {
      history = JSON.parse(history);
    } catch (e) {
      history = [];
    }
  }

  // If there's an audio file but no message, set a default message.
  const audioFile = req.file;
  if (!message && !audioFile) {
    return res.status(400).json({ error: 'Message or audio is required' });
  }

  // In audio-only mode, the message might be undefined from the form data, so give a default
  if (!message && audioFile) {
      message = "Answer the user's question from this audio recording:";
  }

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const result = await getRagResponse(message, history || [], req.authSessionId, audioFile);
    for await (const chunk of result) {
      const text = chunk.text;
      if (text) res.write(text);
    }
    res.end();
  } catch (err) {
    console.error('Rag Chat Error:', err);
    if (!res.headersSent) {
      res.status(500).send(err.message || 'Error generating response');
    } else {
      res.write('\n[Error: ' + err.message + ']');
      res.end();
    }
  }
};

const handleCompanyChat = async (req, res) => {
  let message = req.body.message;
  let history = req.body.history;
  const tableName = req.body.tableName;
  
  if (typeof history === 'string') {
    try {
      history = JSON.parse(history);
    } catch (e) {
      history = [];
    }
  }

  const audioFile = req.file;
  if (!message && !audioFile) {
    return res.status(400).json({ error: 'Message or audio is required' });
  }

  if (!message && audioFile) {
      message = "Answer the user's question from this audio recording:";
  }

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const result = await getCompanyRagResponse(message, history || [], tableName, audioFile);
    for await (const chunk of result) {
      const text = chunk.text;
      if (text) res.write(text);
    }
    res.end();
  } catch (err) {
    console.error('Company Rag Chat Error:', err);
    if (!res.headersSent) {
      res.status(500).send(err.message || 'Error generating response');
    } else {
      res.write('\n[Error: ' + err.message + ']');
      res.end();
    }
  }
};

const handleCompanyChatV2 = async (req, res) => {
  let message = req.body.message;
  let history = req.body.history;
  const tableName = req.body.tableName;
  
  if (typeof history === 'string') {
    try {
      history = JSON.parse(history);
    } catch (e) {
      history = [];
    }
  }

  const audioFile = req.file;
  if (!message && !audioFile) {
    return res.status(400).json({ error: 'Message or audio is required' });
  }

  if (!message && audioFile) {
      message = "Answer the user's question from this audio recording:";
  }

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const result = await getCompanyRagResponseV2(message, history || [], tableName, audioFile);
    for await (const chunk of result) {
      const text = chunk.text;
      if (text) res.write(text);
    }
    res.end();
  } catch (err) {
    console.error('Company Rag Chat V2 Error:', err);
    if (!res.headersSent) {
      res.status(500).send(err.message || 'Error generating response');
    } else {
      res.write('\n[Error: ' + err.message + ']');
      res.end();
    }
  }
};

const handleClearKnowledgeBase = (req, res) => {
  const result = clearKnowledgeBase(req.authSessionId);
  res.status(200).json(result);
};

module.exports = { handleUpload, handleRagChat, handleCompanyChat, handleCompanyChatV2, handleClearKnowledgeBase };
