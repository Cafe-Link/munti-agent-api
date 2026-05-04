const { processFile, getRagResponse, getCompanyRagResponse, getCompanyRagResponseV2, clearKnowledgeBase } = require('../services/ragAgent');
const gcsService = require('../services/ingestion/gcsService');

const handleUpload = async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    // 1. Upload to GCS
    const result = await gcsService.uploadFile(file);

    // 2. Process file using GCS metadata and buffer
    const processResult = await processFile({
        ...file,
        gcsFileName: result.fileName,
        gcsUrl: result.url
    });

    res.status(200).json(processResult);
  } catch (err) {
    console.error('Error in handleUpload:', err);
    res.status(500).json({ error: 'Error processing file' });
  }
};

const handleRagChat = async (req, res) => {
  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const result = await getRagResponse(message, history || []);
    for await (const chunk of result.stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
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
  const { message, history, tableName } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const result = await getCompanyRagResponse(message, history || [], tableName);
    for await (const chunk of result.stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
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
  const { message, history, tableName } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    const result = await getCompanyRagResponseV2(message, history || [], tableName);
    for await (const chunk of result.stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
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
  const result = clearKnowledgeBase();
  res.status(200).json(result);
};

module.exports = { handleUpload, handleRagChat, handleCompanyChat, handleCompanyChatV2, handleClearKnowledgeBase };
