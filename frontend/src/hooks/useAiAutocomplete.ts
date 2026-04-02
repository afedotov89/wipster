import { useState, useCallback, useRef } from "react";
import { aiAutocomplete } from "@/utils/tauri";
import { appLog } from "@/stores/logStore";

interface AutocompleteState {
  suggestion: string | null;
  loading: boolean;
  fieldName: string | null;
}

export function useAiAutocomplete(taskId: string | null, triggerChar = "/") {
  const [state, setState] = useState<AutocompleteState>({
    suggestion: null,
    loading: false,
    fieldName: null,
  });
  const abortRef = useRef(false);

  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent,
      fieldName: string,
      _currentValue: string,
      setValue: (v: string) => void
    ) => {
      if (e.key === "Tab" && state.suggestion && state.fieldName === fieldName) {
        e.preventDefault();
        setValue(state.suggestion);
        setState({ suggestion: null, loading: false, fieldName: null });
        appLog.info(`Autocomplete accepted for ${fieldName}`);
        return;
      }
      if (e.key === "Escape" && state.suggestion) {
        setState({ suggestion: null, loading: false, fieldName: null });
        return;
      }
    },
    [state.suggestion, state.fieldName]
  );

  const handleChange = useCallback(
    (fieldName: string, value: string) => {
      // Don't clear suggestion if we're loading or just received it
      if (state.suggestion && state.fieldName === fieldName && !value.endsWith(triggerChar)) {
        setState({ suggestion: null, loading: false, fieldName: null });
      }

      if (value.endsWith(triggerChar) && taskId) {
        abortRef.current = false;
        setState({ suggestion: null, loading: true, fieldName });
        appLog.info(`Autocomplete triggered for "${fieldName}" (task=${taskId})`);

        aiAutocomplete(taskId, fieldName, value)
          .then((result) => {
            if (!abortRef.current) {
              appLog.info(`Autocomplete result for "${fieldName}" (${result.length} chars): "${result}"`);
              if (result && result.trim().length > 0) {
                setState({ suggestion: result.trim(), loading: false, fieldName });
              } else {
                appLog.warn(`Autocomplete returned empty for "${fieldName}"`);
                setState({ suggestion: null, loading: false, fieldName: null });
              }
            }
          })
          .catch((err) => {
            appLog.error(`Autocomplete failed for "${fieldName}": ${String(err)}`);
            if (!abortRef.current) {
              setState({ suggestion: null, loading: false, fieldName: null });
            }
          });
      }
    },
    [taskId, triggerChar, state.suggestion, state.fieldName]
  );

  const dismiss = useCallback(() => {
    abortRef.current = true;
    setState({ suggestion: null, loading: false, fieldName: null });
  }, []);

  return {
    suggestion: state.suggestion,
    loading: state.loading,
    activeField: state.fieldName,
    handleKeyDown,
    handleChange,
    dismiss,
  };
}
