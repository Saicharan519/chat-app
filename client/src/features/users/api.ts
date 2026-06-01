import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export function useSearchUsers(query: string) {
  return useQuery<User[], Error>({
    queryKey: ['users', 'search', query],
    queryFn: async () => {
      const response = await client.get<User[]>('/users/search', {
        params: { q: query },
      });
      return response.data;
    },
    enabled: query.trim().length > 0,
  });
}
