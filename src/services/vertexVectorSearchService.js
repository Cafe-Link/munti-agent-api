const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { VECTOR_SEARCH } = require('../config/constants');

class VertexVectorSearchService {
  constructor() {
    this.auth = new GoogleAuth({
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
  }

  async getAccessToken() {
    try {
      const client = await this.auth.getClient();
      const tokenResponse = await client.getAccessToken();
      return tokenResponse.token;
    } catch (error) {
      console.error('[VertexSearch] Error getting access token:', error);
      throw new Error('Failed to obtain access token for Vertex AI Vector Search');
    }
  }

  async findNeighbors(featureVector, neighborCount = 5
  ) {
    if (!VECTOR_SEARCH.indexEndpoint || !VECTOR_SEARCH.deployedIndexId || !VECTOR_SEARCH.apiEndpoint) {
      throw new Error('Vertex AI Vector Search configuration is missing (API_ENDPOINT, INDEX_ENDPOINT, or DEPLOYED_INDEX_ID)');
    }

    const accessToken = await this.getAccessToken();
    const url = `https://${VECTOR_SEARCH.apiEndpoint}/v1/${VECTOR_SEARCH.indexEndpoint}:findNeighbors`;

    // Build the request body
    const requestBody = {
      deployedIndexId: VECTOR_SEARCH.deployedIndexId,
      queries: [
        {
          datapoint: {
            featureVector: featureVector
          },
          neighborCount: neighborCount
        }
      ],
      returnFullDatapoint: false
    };

    console.log('[VertexSearch] Executing findNeighbors REST request to:', url);
    console.log('[VertexSearch] Request Body:', JSON.stringify({ ...requestBody, queries: [{ ...requestBody.queries[0], datapoint: { featureVector: `[Array of ${featureVector.length}]` } }] }));

    try {
      const response = await axios.post(url, requestBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('[VertexSearch] REST Response received:', JSON.stringify(response.data, null, 2));
      
      // The REST response structure might use snake_case for field names
      // Vertex AI REST API often returns datapoint_id instead of datapointId
      const nearestNeighbors = response.data.nearestNeighbors?.[0]?.neighbors || [];
      
      // Map to ensure uniform structure (checking both cases just in case)
      const neighbors = nearestNeighbors.map(n => ({
        datapoint: {
          datapointId: n.datapoint?.datapoint_id || n.datapoint?.datapointId,
          ...n.datapoint
        },
        distance: n.distance
      }));

      console.log(`[VertexSearch] Found ${neighbors.length} neighbors`);
      
      return neighbors;
    } catch (error) {
      console.error('[VertexSearch] Error in findNeighbors REST call:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new VertexVectorSearchService();
