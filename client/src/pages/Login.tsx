import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { client } from '@/lib/client';
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email({ message: 'Must be a valid email address' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const loginStore = useAuthStore((state) => state.login);
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    setApiError(null);
    try {
      const response = await client.post<{ accessToken: string }>('/auth/login', data);
      const { accessToken } = response.data;
      loginStore(accessToken);
      navigate('/', { replace: true });
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.response?.data?.error) {
        setApiError(error.response.data.error);
      } else {
        setApiError('Something went wrong. Please check your connection and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#09090b] px-4 relative overflow-hidden">
      {/* Dynamic ambient backgrounds */}
      <div className="absolute top-1/3 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-accent-violet/10 blur-[130px] pointer-events-none animate-sparkle"></div>
      <div className="absolute bottom-1/3 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 rounded-full bg-accent-blue/10 blur-[130px] pointer-events-none"></div>

      <div className="w-full max-w-md glass-panel border border-white/5 rounded-2xl p-8 shadow-2xl relative z-10 space-y-8">
        {/* Title / Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-accent-violet/10 border border-accent-violet/20 items-center justify-center text-accent-violet mb-2">
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">
            Welcome back
          </h1>
          <p className="text-zinc-400 text-sm">
            Enter your credentials to access your chat room
          </p>
        </div>

        {apiError && (
          <div className="flex items-center gap-3 bg-accent-pink/10 border border-accent-pink/20 rounded-xl p-4 text-accent-pink text-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>{apiError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Email input */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Email Address
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-500">
                <Mail className="w-5 h-5" />
              </span>
              <input
                {...register('email')}
                type="email"
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-zinc-200 text-sm outline-none glass-input transition-all duration-200 focus:border-accent-violet/50"
                disabled={isLoading}
              />
            </div>
            {errors.email && (
              <p className="text-accent-pink text-xs flex items-center gap-1">
                <span>•</span> {errors.email.message}
              </p>
            )}
          </div>

          {/* Password input */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Password
              </label>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-500">
                <Lock className="w-5 h-5" />
              </span>
              <input
                {...register('password')}
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                className="w-full pl-10 pr-12 py-3 rounded-xl text-zinc-200 text-sm outline-none glass-input transition-all duration-200 focus:border-accent-violet/50"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-500 hover:text-zinc-300 transition-colors"
                disabled={isLoading}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-accent-pink text-xs flex items-center gap-1">
                <span>•</span> {errors.password.message}
              </p>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-accent-violet to-accent-pink hover:from-accent-violet/90 hover:to-accent-pink/90 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-accent-violet/20 hover:shadow-accent-violet/30 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="text-center text-sm text-zinc-400">
          Don't have an account?{' '}
          <Link
            to="/register"
            className="text-accent-violet hover:text-accent-pink transition-colors font-medium"
          >
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
};

