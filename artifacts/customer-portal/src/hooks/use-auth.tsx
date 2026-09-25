import { useState, useEffect, createContext, useContext } from "react";
import { apiFetch } from "@/lib/api";
import { useLocation } from "wouter";

type AuthUser = {
  user: { id: number; email: string; status: string; portal_role: string; last_login_at: string | null; show_pricing?: boolean };
  customer: { id: number; name: string; logo_url?: string | null; dept_manager_can_approve?: boolean };
  firstName?: string;
  isPreview?: boolean;
  previewEmployeeName?: string | null;
  linkedEmployeeId?: number | null;
};

type AuthContextType = {
  user: AuthUser | null;
  loading: boolean;
  portalRole: string;
  isManager: boolean;
  isDeptManager: boolean;
  canApproveOrders: boolean;
  isPreview: boolean;
  previewEmployeeName: string | null;
  canSeePricing: boolean;
  logout: () => void;
  refetchUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();

  const fetchUser = async () => {
    try {
      const token = localStorage.getItem("portal_token");
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      const data = await apiFetch("/portal/auth/me");
      setUser(data);
    } catch (err) {
      setUser(null);
      localStorage.removeItem("portal_token");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const logout = () => {
    localStorage.removeItem("portal_token");
    localStorage.removeItem("portal_customer_id");
    localStorage.removeItem("portal_customer_name");
    localStorage.removeItem("portal_email");
    localStorage.removeItem("portal_role");
    setUser(null);
    setLocation("/login");
  };

  const portalRole = user?.user?.portal_role ?? localStorage.getItem("portal_role") ?? "member";
  const isManager = portalRole === "manager";
  const isDeptManager = portalRole === "dept_manager";
  const canApproveOrders = isManager || (isDeptManager && user?.customer?.dept_manager_can_approve !== false);
  const isPreview = user?.isPreview === true;
  const previewEmployeeName = user?.previewEmployeeName ?? null;
  // show_pricing is stored per user in the DB. For preview sessions the API
  // derives it from the role (managers → true, others → false).
  const canSeePricing = user?.user?.show_pricing === true;

  return (
    <AuthContext.Provider value={{ user, loading, portalRole, isManager, isDeptManager, canApproveOrders, isPreview, previewEmployeeName, canSeePricing, logout, refetchUser: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
