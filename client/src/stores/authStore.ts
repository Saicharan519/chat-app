import { create } from 'zustand';
import { tokenStore } from '@/lib/tokenStore';
import { refreshClient } from '@/lib/refreshClient';
import { client } from '@/lib/client';

export interface User {
  id: string;
  username: string;
  email: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  login: (accessToken: string) => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export function decodeJwt(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      window
        .atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Failed to decode JWT token:', error);
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setLoading: (loading) => set({ isLoading: loading }),

  login: (accessToken) => {
    tokenStore.setToken(accessToken);
    const decoded = decodeJwt(accessToken);
    if (decoded) {
      set({
        user: {
          id: decoded.userId,
          username: decoded.username,
          email: decoded.email,
        },
        isAuthenticated: true,
      });
    }
  },

  logout: async () => {
    try {
      await client.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      tokenStore.clear();
      set({ user: null, isAuthenticated: false });
    }
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const response = await refreshClient.post<{ accessToken: string }>('/auth/refresh');
      const { accessToken } = response.data;
      tokenStore.setToken(accessToken);
      const decoded = decodeJwt(accessToken);
      if (decoded) {
        set({
          user: {
            id: decoded.userId,
            username: decoded.username,
            email: decoded.email,
          },
          isAuthenticated: true,
        });
      } else {
        set({ user: null, isAuthenticated: false });
      }
    } catch (error) {
      // Refresh token is missing or expired, clear in-memory token
      tokenStore.clear();
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },
}));
