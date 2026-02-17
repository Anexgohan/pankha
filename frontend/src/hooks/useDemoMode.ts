import { useEffect, useState } from "react";
import { getDeploymentHubConfig } from "../services/api";

interface DemoModeState {
  isDemoMode: boolean;
  loading: boolean;
  error: string | null;
}

export const useDemoMode = (): DemoModeState => {
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchMode = async () => {
      try {
        const config = await getDeploymentHubConfig();
        if (!mounted) return;
        setIsDemoMode(config.isDemoMode === true);
        setError(null);
      } catch (err) {
        if (!mounted) return;
        setIsDemoMode(false);
        setError(err instanceof Error ? err.message : "Failed to detect mode");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchMode();

    return () => {
      mounted = false;
    };
  }, []);

  return { isDemoMode, loading, error };
};

