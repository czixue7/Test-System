import { useNavigate } from 'react-router-dom';

export function useBackNavigation(fallback: string) {
  const navigate = useNavigate();
  return () => {
    // React Router tracks entries for this app separately from the browser's history.
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}
