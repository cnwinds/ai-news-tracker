/**
 * 主应用组件
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { AIConversationProvider } from '@/contexts/AIConversationContext';
import Dashboard from '@/pages/Dashboard';
import './App.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppContent() {
  const { themeConfig } = useTheme();
  
  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AIConversationProvider>
          <AppContent />
        </AIConversationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

