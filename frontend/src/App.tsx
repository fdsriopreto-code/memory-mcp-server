import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { WsProvider } from "./contexts/WsContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import AppLayout from "./layouts/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ProjectsPage from "./pages/ProjectsPage";
import MemoriesPage from "./pages/MemoriesPage";
import TasksPage from "./pages/TasksPage";
import WriteRequestsPage from "./pages/WriteRequestsPage";
import AuditLogPage from "./pages/AuditLogPage";
import AgentsPage from "./pages/AgentsPage";
import LogsPage from "./pages/LogsPage";
import ExternalServicesPage from "./pages/ExternalServicesPage";
import SearchPage from "./pages/SearchPage";
import BrainPage from "./pages/BrainPage";
import BrainGraphPage from "./pages/BrainGraphPage";
import JobsPage from "./pages/JobsPage";
import ChatPage from "./pages/ChatPage";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <AuthProvider>
        <WsProvider>
          <Toaster richColors position="top-right" />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<PrivateRoute><AppLayout /></PrivateRoute>}>
              <Route path="/"               element={<DashboardPage />} />
              <Route path="/projects"       element={<ProjectsPage />} />
              <Route path="/memories"       element={<MemoriesPage />} />
              <Route path="/tasks"          element={<TasksPage />} />
              <Route path="/write-requests" element={<WriteRequestsPage />} />
              <Route path="/audit"          element={<AuditLogPage />} />
              <Route path="/agents"         element={<AgentsPage />} />
              <Route path="/logs"           element={<LogsPage />} />
              <Route path="/services"       element={<ExternalServicesPage />} />
              <Route path="/search"         element={<SearchPage />} />
              <Route path="/brain"          element={<BrainPage />} />
              <Route path="/brain-graph"    element={<BrainGraphPage />} />
              <Route path="/jobs"           element={<JobsPage />} />
              <Route path="/chat"           element={<ChatPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </WsProvider>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
