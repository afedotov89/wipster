import { apiClient } from '../contexts/AuthContext';

// Base API class that can be extended for specific endpoints
export class BaseApi {
  constructor(path) {
    this.path = path;
  }

  // GET request
  async get(endpoint = '', params = {}) {
    try {
      const url = endpoint ? `${this.path}/${endpoint}` : this.path;
      const response = await apiClient.get(url, { params });
      return response.data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  // POST request
  async post(endpoint = '', data = {}) {
    try {
      const url = endpoint ? `${this.path}/${endpoint}` : this.path;
      const response = await apiClient.post(url, data);
      return response.data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  // PUT request
  async put(endpoint = '', data = {}) {
    try {
      const url = endpoint ? `${this.path}/${endpoint}` : this.path;
      const response = await apiClient.put(url, data);
      return response.data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  // DELETE request
  async delete(endpoint = '') {
    try {
      const url = endpoint ? `${this.path}/${endpoint}` : this.path;
      const response = await apiClient.delete(url);
      return response.data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  // Error handler
  handleError(error) {
    console.error('API Error:', error);
    // Additional error handling can be added here
  }
}

// Example API instance
export const api = new BaseApi('/api/v1');

export default api;