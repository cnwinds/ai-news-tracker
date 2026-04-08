import { type ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

import { KnowledgeGraphViewProvider } from '@/contexts/KnowledgeGraphViewContext';
import { ThemeProvider } from '@/contexts/ThemeContext';

export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <KnowledgeGraphViewProvider>
            <ConfigProvider locale={zhCN}>
              <AntdApp>{ui}</AntdApp>
            </ConfigProvider>
          </KnowledgeGraphViewProvider>
        </ThemeProvider>
      </QueryClientProvider>
    ),
  };
}
