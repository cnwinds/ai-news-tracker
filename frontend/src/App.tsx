import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { AIConversationProvider } from '@/contexts/AIConversationContext';
import { AuthProvider } from '@/contexts/AuthContext';
import AccessTracker from '@/components/AccessTracker';
import Dashboard from '@/pages/Dashboard';
import Login from '@/pages/Login';
import ShareArticle from '@/pages/ShareArticle';
import ShareSummary from '@/pages/ShareSummary';
import './App.css';

const STALE_TIME = 5 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: STALE_TIME,
    },
  },
});

function AppContent() {
  const { themeConfig } = useTheme();

  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntdApp>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <AccessTracker />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/share/:id" element={<ShareArticle />} />
            <Route path="/share/summary/:id" element={<ShareSummary />} />
          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <AIConversationProvider>
            <AppContent />
          </AIConversationProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;

