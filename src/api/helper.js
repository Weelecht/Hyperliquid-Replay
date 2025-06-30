// API Helper Functions

/**
 * Base API configuration
 */
export const API_CONFIG = {
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
};

/**
 * Generic API request function
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Request options
 * @returns {Promise} - API response
 */
export const apiRequest = async (endpoint, options = {}) => {
  const url = `${API_CONFIG.baseURL}${endpoint}`;
  
  const config = {
    ...API_CONFIG,
    ...options,
    headers: {
      ...API_CONFIG.headers,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
};

/**
 * GET request helper
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Query parameters
 * @returns {Promise} - API response
 */
export const get = async (endpoint, params = {}) => {
  const queryString = new URLSearchParams(params).toString();
  const url = queryString ? `${endpoint}?${queryString}` : endpoint;
  
  return apiRequest(url, {
    method: 'GET',
  });
};

/**
 * POST request helper
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request body data
 * @returns {Promise} - API response
 */
export const post = async (endpoint, data = {}) => {
  return apiRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

/**
 * PUT request helper
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request body data
 * @returns {Promise} - API response
 */
export const put = async (endpoint, data = {}) => {
  return apiRequest(endpoint, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

/**
 * DELETE request helper
 * @param {string} endpoint - API endpoint
 * @returns {Promise} - API response
 */
export const del = async (endpoint) => {
  return apiRequest(endpoint, {
    method: 'DELETE',
  });
};

/**
 * Error handler utility
 * @param {Error} error - Error object
 * @returns {Object} - Formatted error object
 */
export const handleApiError = (error) => {
  return {
    message: error.message || 'An unexpected error occurred',
    status: error.status || 500,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Response formatter utility
 * @param {any} data - Response data
 * @param {boolean} success - Success status
 * @param {string} message - Response message
 * @returns {Object} - Formatted response object
 */
export const formatResponse = (data, success = true, message = '') => {
  return {
    success,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
}; 