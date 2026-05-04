const { Storage } = require('@google-cloud/storage');
const { GCS_BUCKET, GOOGLE_CLOUD_PROJECT } = require('../../config/constants');

class GCSService {
  constructor() {
    this.storage = new Storage({ project: GOOGLE_CLOUD_PROJECT });
    this.bucketName = GCS_BUCKET;
  }

  /**
   * Uploads a file buffer to GCS inside the 'uploaded-doc' folder.
   */
  async uploadFile(file) {
    const bucket = this.storage.bucket(this.bucketName);
    const gcsFileName = `uploaded-doc/${Date.now()}-${file.originalname}`;
    const gcsFile = bucket.file(gcsFileName);

    await gcsFile.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
      },
    });

    console.log(`[GCS] File uploaded: ${gcsFileName}`);
    return {
      fileName: gcsFileName,
      url: `gs://${this.bucketName}/${gcsFileName}`,
      mimetype: file.mimetype
    };
  }

  /**
   * Deletes all files within the 'uploaded-doc/' folder.
   */
  async clearUploadedDocs() {
    const bucket = this.storage.bucket(this.bucketName);
    console.log(`[GCS] Clearing all files in folder: uploaded-doc/`);
    await bucket.deleteFiles({ prefix: 'uploaded-doc/' });
    return { success: true, message: 'All uploaded documents cleared from GCS' };
  }

  /**
   * Downloads a file from GCS as a buffer.
   */
  async downloadFile(fileName) {
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(fileName);
    const [content] = await file.download();
    return content;
  }

  /**
   * Generates a read stream for a file in GCS.
   */
  getFileStream(fileName) {
    const bucket = this.storage.bucket(this.bucketName);
    return bucket.file(fileName).createReadStream();
  }
}

module.exports = new GCSService();
