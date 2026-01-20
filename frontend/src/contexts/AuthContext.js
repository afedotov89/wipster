import React, { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react';
import axios from 'axios';
import Cookies from 'js-cookie';

// Get backend URL from environment variable or default
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// Configure axios instance for API calls
// Export apiClient so it can be used by other modules (like exerciseApi)
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Important for session-based auth (cookies)
  // Disable automatic XSRF token handling
  xsrfCookieName: 'csrftoken', // Keep for reference, but not used automatically
  xsrfHeaderName: 'X-CSRFToken', // Keep for reference, but not used automatically
  withXSRFToken: false, // Turn off automatic handling
  headers: {
    'Content-Type': 'application/json',
  }
});

// Create the Auth Context
const AuthContext = createContext();

// Auth Provider Component
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // Start with loading true
  // State to store the CSRF token received from the backend
  const [csrfToken, setCsrfToken] = useState(null);
  // Use useRef to store the token for the interceptor to avoid stale closure issues
  const csrfTokenRef = useRef(csrfToken);

  // Keep the ref updated whenever the state changes
  useEffect(() => {
    csrfTokenRef.current = csrfToken;
  }, [csrfToken]);

  // Add request interceptor to manually add CSRF token header
  useEffect(() => {
    const requestInterceptor = apiClient.interceptors.request.use(
      (config) => {
        const method = config.method.toLowerCase();
        if (['post', 'put', 'patch', 'delete'].includes(method)) {
          let currentToken = csrfTokenRef.current;
          if (!currentToken) {
            // Если токена нет в состоянии, пробуем взять из cookie
            currentToken = Cookies.get('csrftoken');
          }
          if (currentToken) {
            config.headers['X-CSRFToken'] = currentToken;
          }
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Clean up interceptor on unmount
    return () => {
      apiClient.interceptors.request.eject(requestInterceptor);
    };
  }, []); // Empty dependency array ensures this runs only once

  // Function to load user data if session exists
  const loadUser = useCallback(async () => {
    setIsLoading(true);
    // Reset CSRF token before trying to load user
    setCsrfToken(null);
    try {
      const response = await apiClient.get('/api/v1/auth/user/');
      setUser(response.data);
      setIsAuthenticated(true);
      // --- Extract CSRF token from response ---
      // IMPORTANT: Assumes backend response includes { ..., "csrfToken": "value" }
      if (response.data && response.data.csrfToken) {
        setCsrfToken(response.data.csrfToken);
        console.log("CSRF token received and stored."); // For debugging
      } else {
        console.warn("CSRF token not found in /api/v1/auth/user/ response.");
        // Maybe request it separately if needed or handle error
      }
      // ----------------------------------------
    } catch (error) {
      setUser(null);
      setIsAuthenticated(false);
      setCsrfToken(null); // Ensure token is cleared on error
      // Don't log error if it's just a 401/403 (not logged in)
      if (error.response && ![401, 403].includes(error.response.status)) {
        console.error('Failed to load user:', error);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load user on initial mount
  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // Login function - No changes needed, interceptor handles CSRF
  const login = async (email, password) => {
    setIsLoading(true);
    try {
      const response = await apiClient.post('/api/v1/auth/login/', { email, password });
      // After successful login, reload user data to confirm session AND get new CSRF token
      await loadUser();
      return response.data;
    } catch (error) {
      console.error('Login failed:', error.response ? error.response.data : error);
      setIsLoading(false); // Ensure loading is stopped on error
      throw error;
    }
    // No finally block needed here as loadUser handles its own finally
  };

  // Google login function
  const googleLogin = async (credential) => {
    setIsLoading(true);
    try {
      // Отладочная информация
      console.log(`Отправляем Google credential на ${API_BASE_URL}/api/v1/auth/google/login/`);
      console.log(`Токен начинается с: ${credential.substring(0, 10)}...`);

      // Отправляем ID-токен как credential
      const response = await apiClient.post('/api/v1/auth/google/login/', {
        credential: credential,
      });

      // Перезагружаем пользовательские данные
      await loadUser();
      return response.data;
    } catch (error) {
      console.error('Google login failed:', error);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      }
      setIsLoading(false);
      throw error;
    }
  };

  // Registration function - No changes needed, interceptor handles CSRF
  const register = async (userData) => {
    setIsLoading(true);
    try {
      const payload = { email: userData.email, password1: userData.password1, password2: userData.password2 };
      const response = await apiClient.post('/api/v1/auth/registration/', payload);
      // Does not automatically log in user, so no need to loadUser here usually
      setIsLoading(false);
      return response.data;
    } catch (error) {
      console.error('Registration failed:', error.response ? error.response.data : error);
      setIsLoading(false);
      throw error;
    }
  };

  // Logout function - No changes needed, interceptor handles CSRF
  const logout = async () => {
    setIsLoading(true);
    try {
      // Interceptor will add the X-CSRFToken header if csrfToken is set
      await apiClient.post('/api/v1/auth/logout/');
    } catch (error) {
      console.error('Logout failed:', error.response ? error.response.data : error);
      // Still proceed to clear client-side state even if backend logout fails
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      setCsrfToken(null); // Clear CSRF token on logout
      setIsLoading(false);
      // Optionally redirect or perform other cleanup
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoading,
      csrfToken,
      login,
      register,
      logout,
      loadUser,
      googleLogin
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use Auth Context
export const useAuth = () => useContext(AuthContext);