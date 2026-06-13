import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { WsProvider } from "./contexts/WsContext";
import AppLayout from "./layouts/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ProjectsPage from "./pages/ProjectsPage";
import MemoriesPage from "./pages/MemoriesPage";
import TasksPage from "./pages/TasksPage";
import WriteRequestsPage from "./pages/WriteRequestsPage";
import AuditLogPage from "./pages/AuditLogPage";
import AgentsPage from "./pages/AgentsPage";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
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
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </WsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
