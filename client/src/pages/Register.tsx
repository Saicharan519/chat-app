import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { client } from '@/lib/client';
import { Mail, Lock, User, Eye, EyeOff, AlertCircle, Check, X } from 'lucide-react';

const registerSchema = z.object({
  username: z
    .string()
    .min(3, { message: 'Username must be at least 3 characters long' })
    .max(50, { message: 'Username cannot exceed 50 characters' })
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message: 'Can only contain letters, numbers, underscores, and hyphens',
    }),
  email: z.string().email({ message: 'Must be a valid email address' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters long' })
    .regex(/[a-z]/, { message: 'Must contain at least one lowercase letter' })
    .regex(/[A-Z]/, { message: 'Must contain at least one uppercase letter' })
    .regex(/[0-9]/, { message: 'Must contain at least one number' })
    .regex(/[^a-zA-Z0-9]/, { message: 'Must contain at least one special character' }),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export const Register: React.FC = () => {
  const navigate = useNavigate();
  const loginStore = useAuthStore((state) => state.login);
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
    },
  });

  const passwordValue = watch('password', '');

  const onSubmit = async (data: RegisterFormValues) => {
    setIsLoading(true);
    setApiError(null);
    try {
      const response = await client.post<{ accessToken: string }>('/auth/register', data);
      const { accessToken } = response.data;
      loginStore(accessToken);
      navigate('/', { replace: true });
    } catch (error: any) {
      console.error('Registration error:', error);
      if (error.response?.data?.error) {
        setApiError(error.response.data.error);
      } else {
        setApiError('Registration failed. Please check details and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Password requirement checkers for dynamic feedback
  const requirements = [
    { label: 'At least 8 characters', test: passwordValue.length >= 8 },
    { label: 'One uppercase letter', test: /[A-Z]/.test(passwordValue) },
    { label: 'One lowercase letter', test: /[a-z]/.test(passwordValue) },
    { label: 'One number', test: /[0-9]/.test(passwordValue) },
    { label: 'One special character (e.g. @, #, $)', test: /[^a-zA-Z0-9]/.test(passwordValue) },
  ];

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#09090b] px-4 py-12 relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-1/3 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-accent-violet/10 blur-[130px] pointer-events-none animate-sparkle"></div>
      <div className="absolute bottom-1/3 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 rounded-full bg-accent-blue/10 blur-[130px] pointer-events-none"></div>

      <div className="w-full max-w-md glass-panel border border-white/5 rounded-2xl p-8 shadow-2xl relative z-10 space-y-8">
        {/* Title */}
        <div className="text-center space-y-2">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-accent-pink/10 border border-accent-pink/20 items-center justify-center text-accent-pink mb-2">
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">
            Create account
          </h1>
          <p className="text-zinc-400 text-sm">
            Join ContextChat and get connected
          </p>
        </div>

        {apiError && (
          <div className="flex items-center gap-3 bg-accent-pink/10 border border-accent-pink/20 rounded-xl p-4 text-accent-pink text-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>{apiError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Username input */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Username
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-500">
                <User className="w-5 h-5" />
              </span>
              <input
                {...register('username')}
                type="text"
                placeholder="chat_master"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-zinc-200 text-sm outline-none glass-input transition-all duration-200 focus:border-accent-violet/50"
                disabled={isLoading}
              />
            </div>
            {errors.username && (
              <p className="text-accent-pink text-xs flex items-center gap-1">
                <span>•</span> {errors.username.message}
              </p>
            )}
          </div>

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
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Password
            </label>
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

            {/* Dynamic checklist for requirements */}
            {passwordValue && (
              <div className="p-3.5 bg-black/40 border border-white/5 rounded-xl space-y-1.5 animate-slide-up">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Password Strength Checklist
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                  {requirements.map((req, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {req.test ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                      )}
                      <span className={req.test ? 'text-zinc-300' : 'text-zinc-500'}>
                        {req.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                Creating account...
              </span>
            ) : (
              'Sign Up'
            )}
          </button>
        </form>

        <div className="text-center text-sm text-zinc-400">
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-accent-violet hover:text-accent-pink transition-colors font-medium"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
};
