"use client";

import {
  FormEvent,
  type MouseEventHandler,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  normalizeObjectQuery,
  objectMatchesObjectQuery,
} from "@/lib/object-filter";
import type { ObjectDataResult } from "@/lib/sui-object-data";
import type {
  LiveObjectResult,
  LiveObjectRow,
  NetworkName,
  VersionObjectsResult,
} from "@/lib/sui-live-objects";

type ThemeMode = "light" | "dark";

type VersionSection = {
  key: string;
  label: string;
  address: string;
  objects: LiveObjectResult["objects"];
  isCurrent: boolean;
  isLatest: boolean;
  isExact: boolean;
};

type ObjectDetailState =
  | { status: "loading" }
  | { status: "loaded"; data: ObjectDataResult }
  | { status: "error"; error: string };

type ApiErrorPayload = {
  error: string;
};

const NETWORKS: NetworkName[] = ["mainnet", "testnet"];
const THEME_STORAGE_KEY = "sui-object-finder-theme";
const VERSION_OBJECT_PAGE_SIZE = 50;

type VersionObjectState = {
  status: "idle" | "loading" | "loaded" | "error";
  objects: LiveObjectRow[];
  hasNextPage: boolean;
  nextCursor: string | null;
  error: string | null;
};

function formatNetworkLabel(network: NetworkName): string {
  return network.charAt(0).toUpperCase() + network.slice(1);
}

function objectNameFromType(objectType: string | null): string {
  if (!objectType) {
    return "unknown";
  }

  const baseType = objectType.split("<")[0] ?? objectType;
  return baseType.split("::").pop() ?? baseType;
}

function CopyButton({
  copied,
  onClick,
}: {
  copied: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      aria-label={copied ? "Copied" : "Copy"}
      className={`copy-button${copied ? " is-copied" : ""}`}
      onClick={onClick}
      type="button"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function LoadingIndicator({ message }: { message: string }) {
  return (
    <span className="loading-indicator" role="status">
      <span aria-hidden="true" className="loading-spinner" />
      <span>{message}</span>
    </span>
  );
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

function describeUnexpectedApiResponse(rawText: string): string {
  const normalized = rawText.trim();
  if (!normalized) {
    return "The server returned an empty response.";
  }

  if (/^<!doctype html/i.test(normalized) || /^<html/i.test(normalized)) {
    return "The server returned an HTML error page instead of JSON. This usually means the deployment returned an error page or timed out.";
  }

  return `The server returned an unexpected response instead of JSON: ${normalized.slice(0, 180)}`;
}

async function readApiPayload<T>(response: Response, fallbackMessage: string): Promise<T | ApiErrorPayload> {
  const rawText = await response.text();

  if (!rawText.trim()) {
    return {
      error: response.ok ? fallbackMessage : `Request failed with HTTP ${response.status}.`,
    };
  }

  try {
    return JSON.parse(rawText) as T | ApiErrorPayload;
  } catch {
    const detail = describeUnexpectedApiResponse(rawText);
    return {
      error: response.ok ? `${fallbackMessage} ${detail}` : `Request failed with HTTP ${response.status}. ${detail}`,
    };
  }
}

function XIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M18.244 2h3.308l-7.228 8.26L22.826 22h-6.655l-5.212-6.817L4.994 22H1.684l7.73-8.835L1.26 2h6.824l4.711 6.231L18.244 2Zm-1.16 18h1.833L7.088 3.895H5.122L17.084 20Z"
        fill="currentColor"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M12 .5C5.649.5.5 5.649.5 12A11.5 11.5 0 0 0 8.36 22.047c.576.105.786-.25.786-.555 0-.273-.01-.996-.016-1.955-3.182.691-3.853-1.533-3.853-1.533-.52-1.322-1.271-1.674-1.271-1.674-1.039-.71.079-.696.079-.696 1.149.08 1.753 1.18 1.753 1.18 1.02 1.748 2.675 1.243 3.327.95.103-.739.399-1.243.726-1.529-2.54-.289-5.212-1.27-5.212-5.654 0-1.249.447-2.271 1.179-3.071-.118-.289-.511-1.453.112-3.03 0 0 .962-.308 3.151 1.173A10.95 10.95 0 0 1 12 6.04a10.95 10.95 0 0 1 2.87.386c2.189-1.48 3.149-1.173 3.149-1.173.625 1.577.232 2.741.114 3.03.734.8 1.178 1.822 1.178 3.071 0 4.395-2.677 5.362-5.226 5.646.41.352.776 1.045.776 2.106 0 1.521-.014 2.748-.014 3.123 0 .309.207.666.792.553A11.501 11.501 0 0 0 23.5 12C23.5 5.649 18.351.5 12 .5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function HomePage() {
  const [packageId, setPackageId] = useState("");
  const [network, setNetwork] = useState<NetworkName>("mainnet");
  const [resultNetwork, setResultNetwork] = useState<NetworkName | null>(null);
  const [result, setResult] = useState<LiveObjectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [objectDetails, setObjectDetails] = useState<Record<string, ObjectDetailState>>({});
  const [versionFilterInputs, setVersionFilterInputs] = useState<Record<string, string>>({});
  const [versionFilterQueries, setVersionFilterQueries] = useState<Record<string, string | null>>(
    {},
  );
  const [versionSharedOnly, setVersionSharedOnly] = useState<Record<string, boolean>>({});
  const [versionObjects, setVersionObjects] = useState<Record<string, VersionObjectState>>({});
  const [isSearching, setIsSearching] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const networkMenuRef = useRef<HTMLDivElement | null>(null);
  const versionRequestIdsRef = useRef<Record<string, number>>({});
  const [isNetworkMenuOpen, setIsNetworkMenuOpen] = useState(false);

  useEffect(() => {
    const currentTheme = document.documentElement.dataset.theme;
    if (currentTheme === "light" || currentTheme === "dark") {
      setTheme(currentTheme);
    }
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) {
      return;
    }

    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, themeReady]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isNetworkMenuOpen) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (!networkMenuRef.current?.contains(event.target as Node)) {
        setIsNetworkMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsNetworkMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isNetworkMenuOpen]);

  const versionSections = useMemo<VersionSection[]>(() => {
    if (!result) {
      return [];
    }

    const latestVersion = result.packageVersions.reduce<number | null>((current, packageVersion) => {
      if (packageVersion.version === null) {
        return current;
      }

      if (current === null || packageVersion.version > current) {
        return packageVersion.version;
      }

      return current;
    }, null);

    return [...result.packageVersions]
      .sort((left, right) => {
        const leftIsSearched =
          left.packageId === result.packageId ||
          left.relation === "current" ||
          left.relation === "exact";
        const rightIsSearched =
          right.packageId === result.packageId ||
          right.relation === "current" ||
          right.relation === "exact";

        if (leftIsSearched !== rightIsSearched) {
          return leftIsSearched ? -1 : 1;
        }

        const leftIsVersionOne = left.version === 1;
        const rightIsVersionOne = right.version === 1;

        if (leftIsVersionOne !== rightIsVersionOne) {
          return leftIsVersionOne ? -1 : 1;
        }

        const leftVersion = left.version ?? Number.MAX_SAFE_INTEGER;
        const rightVersion = right.version ?? Number.MAX_SAFE_INTEGER;

        if (leftVersion !== rightVersion) {
          return leftVersion - rightVersion;
        }

        return left.packageId.localeCompare(right.packageId);
      })
      .map((packageVersion) => {
        const key =
          packageVersion.version === null ? packageVersion.packageId : `v${packageVersion.version}`;

        return {
          key,
          label: packageVersion.version === null ? "Exact" : `v${packageVersion.version}`,
          address: packageVersion.packageId,
          objects: result.objectsByVersion[key] ?? [],
          isCurrent: packageVersion.relation === "current",
          isLatest:
            packageVersion.version !== null && latestVersion !== null
              ? packageVersion.version === latestVersion
              : false,
          isExact: packageVersion.relation === "exact",
        };
      });
  }, [result]);

  const loadedObjectCount = useMemo(
    () =>
      Object.values(versionObjects).reduce((count, state) => {
        return count + state.objects.length;
      }, 0),
    [versionObjects],
  );

  useEffect(() => {
    if (!result) {
      setOpenSections({});
      return;
    }

    const nextOpenSections: Record<string, boolean> = {};
    for (const section of versionSections) {
      nextOpenSections[section.key] = section.isCurrent || section.isLatest || section.isExact;
    }
    setOpenSections(nextOpenSections);
  }, [result, versionSections]);

  async function copyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);

      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }

      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1400);
    } catch {
      setCopiedKey(null);
    }
  }

  async function runSearch() {
    setIsSearching(true);
    setIsNetworkMenuOpen(false);
    setError(null);
    versionRequestIdsRef.current = {};

    try {
      const response = await fetch("/api/live-objects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          packageId,
          network,
          exactPackageOnly: false,
        }),
      });

      const payload = await readApiPayload<LiveObjectResult>(response, "Search failed.");

      if (!response.ok || isApiErrorPayload(payload)) {
        setResult(null);
        setResultNetwork(null);
        setObjectDetails({});
        setVersionFilterInputs({});
        setVersionFilterQueries({});
        setVersionSharedOnly({});
        setVersionObjects({});
        setError(isApiErrorPayload(payload) ? payload.error : "Search failed.");
        return;
      }

      setObjectDetails({});
      setVersionFilterInputs({});
      setVersionFilterQueries({});
      setVersionSharedOnly({});
      setVersionObjects({});
      setResultNetwork(network);
      setResult(payload);
    } finally {
      setIsSearching(false);
    }
  }

  function isVersionSharedOnly(sectionKey: string): boolean {
    return versionSharedOnly[sectionKey] ?? true;
  }

  function applyVersionFilter(
    sectionKey: string,
    versionPackageId: string,
    sharedOnlyOverride?: boolean,
  ) {
    const nextQuery = normalizeObjectQuery(versionFilterInputs[sectionKey] ?? "");
    const nextSharedOnly = sharedOnlyOverride ?? isVersionSharedOnly(sectionKey);

    setVersionFilterQueries((current) => ({
      ...current,
      [sectionKey]: nextQuery,
    }));

    setVersionSharedOnly((current) => ({
      ...current,
      [sectionKey]: nextSharedOnly,
    }));

    const nextRequestId = (versionRequestIdsRef.current[sectionKey] ?? 0) + 1;
    versionRequestIdsRef.current[sectionKey] = nextRequestId;

    if (!result?.objectsOmitted) {
      return;
    }

    const existing = versionObjects[sectionKey];
    if (existing?.status === "loaded" && !existing.hasNextPage) {
      return;
    }

    setVersionObjects((current) => ({
      ...current,
      [sectionKey]: {
        status: "loading",
        objects: [],
        hasNextPage: true,
        nextCursor: null,
        error: null,
      },
    }));

    void streamVersionObjects(sectionKey, versionPackageId, nextQuery, nextSharedOnly, nextRequestId);
  }

  async function streamVersionObjects(
    sectionKey: string,
    versionPackageId: string,
    objectQuery: string | null,
    sharedOnly: boolean,
    requestId: number,
  ) {
    let cursor: string | null = null;
    const streamedObjects: LiveObjectRow[] = [];

    while (true) {
      const response: Response = await fetch("/api/version-objects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          packageId: versionPackageId,
          network: resultNetwork ?? network,
          cursor,
          objectQuery,
          sharedOnly,
          pageSize: VERSION_OBJECT_PAGE_SIZE,
        }),
      });

      const payload: VersionObjectsResult | ApiErrorPayload = await readApiPayload<VersionObjectsResult>(
        response,
        "Failed to load version objects.",
      );
      if (versionRequestIdsRef.current[sectionKey] !== requestId) {
        return;
      }

      if (!response.ok || isApiErrorPayload(payload)) {
        setVersionObjects((current) => ({
          ...current,
          [sectionKey]: {
            status: "error",
            objects: [...streamedObjects],
            hasNextPage: false,
            nextCursor: null,
            error: isApiErrorPayload(payload) ? payload.error : "Failed to load version objects.",
          },
        }));
        return;
      }

      streamedObjects.push(...payload.objects);
      const hasNextPage = payload.hasNextPage && payload.nextCursor !== null;

      setVersionObjects((current) => ({
        ...current,
        [sectionKey]: {
          status: hasNextPage ? "loading" : "loaded",
          objects: [...streamedObjects],
          hasNextPage,
          nextCursor: payload.nextCursor,
          error: null,
        },
      }));

      if (!hasNextPage) {
        return;
      }

      cursor = payload.nextCursor;
    }
  }

  async function loadObjectDetail(objectId: string) {
    const existing = objectDetails[objectId];
    if (existing?.status === "loading" || existing?.status === "loaded") {
      return;
    }

    setObjectDetails((current) => ({
      ...current,
      [objectId]: { status: "loading" },
    }));

    const response = await fetch("/api/object-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        objectId,
        network: resultNetwork ?? network,
      }),
    });

    const payload = await readApiPayload<ObjectDataResult>(response, "Failed to load object data.");

    if (!response.ok || isApiErrorPayload(payload)) {
      setObjectDetails((current) => ({
        ...current,
        [objectId]: {
          status: "error",
          error: isApiErrorPayload(payload) ? payload.error : "Failed to load object data.",
        },
      }));
      return;
    }

    setObjectDetails((current) => ({
      ...current,
      [objectId]: {
        status: "loaded",
        data: payload,
      },
    }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  function onToggleTheme() {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand">Sui Objects Finder</span>
          {!result ? (
            <span className="brand-subtitle">
              Find live Sui objects from a package and its versions.
            </span>
          ) : null}
        </div>
        <button
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          className="theme-toggle"
          onClick={onToggleTheme}
          type="button"
        >
          <span className="sr-only">Toggle theme</span>
        </button>
      </header>

      <section className={`search-shell${result ? " has-results" : " is-empty"}`}>
        <form className="search-form" onSubmit={onSubmit}>
          <div className="search-row">
            <input
              autoComplete="off"
              className="search-input"
              name="packageId"
              onChange={(event) => setPackageId(event.target.value)}
              placeholder="Search package address: 0x..."
              value={packageId}
            />

            <div className="network-menu" ref={networkMenuRef}>
              <button
                aria-expanded={isNetworkMenuOpen}
                aria-haspopup="listbox"
                className={`search-select search-select-trigger${isNetworkMenuOpen ? " is-open" : ""}`}
                onClick={() => {
                  setIsNetworkMenuOpen((current) => !current);
                }}
                type="button"
              >
                <span>{formatNetworkLabel(network)}</span>
                <span aria-hidden="true" className="search-select-caret" />
              </button>

              {isNetworkMenuOpen ? (
                <div className="network-menu-list" role="listbox">
                  {NETWORKS.map((networkOption) => (
                    <button
                      aria-selected={networkOption === network}
                      className={`network-menu-option${networkOption === network ? " is-active" : ""}`}
                      key={networkOption}
                      onClick={() => {
                        setNetwork(networkOption);
                        setIsNetworkMenuOpen(false);
                      }}
                      role="option"
                      type="button"
                    >
                      {formatNetworkLabel(networkOption)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              className="search-button"
              disabled={isSearching}
              type="submit"
            >
              <span className="search-button-text">{isSearching ? "Searching" : "Search"}</span>
            </button>
          </div>

          {isSearching ? (
            <div aria-live="polite" className="search-status">
              <LoadingIndicator message="Searching package..." />
            </div>
          ) : null}
        </form>
      </section>

      {error ? <section className="error-banner">{error}</section> : null}

      {result ? (
        <>
          <section className="result-summary">
            <article className="summary-card summary-card-wide">
              <span className="summary-label">Package</span>
              <div className="copy-row">
                <code className="code-text">{result.packageId}</code>
                <CopyButton
                  copied={copiedKey === "package"}
                  onClick={(event) => {
                    event.preventDefault();
                    void copyValue("package", result.packageId);
                  }}
                />
              </div>
            </article>

            <article className="summary-card">
              <span className="summary-label">Network</span>
              <strong>{formatNetworkLabel(resultNetwork ?? network)}</strong>
            </article>

            <article className="summary-card">
              <span className="summary-label">Versions</span>
              <strong>{versionSections.length}</strong>
            </article>

            <article className="summary-card">
              <span className="summary-label">Objects</span>
              <strong>
                {result.objectsOmitted
                  ? loadedObjectCount > 0
                    ? `Loaded ${loadedObjectCount}`
                    : "Skipped"
                  : result.count}
              </strong>
            </article>
          </section>

          {result.objectsOmitted ? (
            <section className="info-banner">
              {result.objectsOmittedReason
                ? `${result.objectsOmittedReason} Search each version below and matching objects will appear as they are found.`
                : "Object scan skipped. Search each version below and matching objects will appear as they are found."}
            </section>
          ) : null}

          <section className="version-list">
            {versionSections.map((section) => (
              (() => {
                const versionObjectState = versionObjects[section.key];
                const versionFilterInput = versionFilterInputs[section.key] ?? "";
                const versionFilterQuery = versionFilterQueries[section.key] ?? null;
                const sectionSharedOnly = isVersionSharedOnly(section.key);
                const baseSectionObjects = result.objectsOmitted
                  ? versionObjectState?.objects ?? []
                  : section.objects;
                const sectionObjects = baseSectionObjects.filter(
                  (object) =>
                    objectMatchesObjectQuery(object, versionFilterQuery) &&
                    (!sectionSharedOnly || object.owner === "Shared"),
                );
                const isVersionLoading = versionObjectState?.status === "loading";
                const hasVersionResults = versionObjectState !== undefined;
                const versionError =
                  versionObjectState?.status === "error" ? versionObjectState.error : null;
                const sectionCountLabel =
                  result.objectsOmitted
                    ? isVersionLoading
                      ? `Loading (${sectionObjects.length})`
                      : hasVersionResults
                        ? `${sectionObjects.length} matches`
                        : "Not searched"
                    : `${sectionObjects.length} objects`;
                const streamStatusMessage = !result.objectsOmitted
                  ? null
                  : isVersionLoading
                    ? sectionObjects.length > 0
                      ? `Loaded ${sectionObjects.length} confirmed matches. Final count still scanning...`
                      : "Scanning this version..."
                    : hasVersionResults
                      ? sectionObjects.length > 0
                        ? `Finished scanning. Found ${sectionObjects.length} matching objects.`
                        : "Finished scanning. No matching objects found."
                      : "Historical object scan was skipped for this package. Run a version search here.";
                const filterButtonLabel = isVersionLoading
                  ? "Searching..."
                  : result.objectsOmitted
                    ? versionFilterQuery
                      ? "Find matches"
                      : "Load objects"
                    : "Filter";

                return (
                  <details
                    className="version-panel"
                    key={section.key}
                    onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setOpenSections((current) => ({
                        ...current,
                        [section.key]: isOpen,
                      }));
                    }}
                    open={openSections[section.key] ?? false}
                  >
                    <summary className="version-summary">
                      <div className="version-main">
                        <div className="version-line">
                          <span className="version-name">{section.label}</span>
                          {section.isCurrent ? <span className="tag">Current</span> : null}
                          {section.isLatest ? <span className="tag tag-accent">Latest</span> : null}
                          {section.isExact ? <span className="tag">Exact</span> : null}
                        </div>
                        <span className="version-count">{sectionCountLabel}</span>
                      </div>

                      <div className="copy-row">
                        <code className="code-text">{section.address}</code>
                        <CopyButton
                          copied={copiedKey === `address:${section.key}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void copyValue(`address:${section.key}`, section.address);
                          }}
                        />
                      </div>
                    </summary>

                    <div className="version-content">
                      <div className="version-filter-row">
                        <input
                          autoComplete="off"
                          className="version-filter-input"
                          onChange={(event) => {
                            setVersionFilterInputs((current) => ({
                              ...current,
                              [section.key]: event.target.value,
                            }));
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") {
                              return;
                            }

                            event.preventDefault();
                            applyVersionFilter(section.key, section.address);
                          }}
                          placeholder="Filter this version by field value"
                          value={versionFilterInput}
                        />
                        <label className="version-toggle">
                          <input
                            checked={sectionSharedOnly}
                            onChange={(event) => {
                              const nextSharedOnly = event.target.checked;
                              setVersionSharedOnly((current) => ({
                                ...current,
                                [section.key]: nextSharedOnly,
                              }));

                              if (result.objectsOmitted && hasVersionResults) {
                                applyVersionFilter(section.key, section.address, nextSharedOnly);
                              }
                            }}
                            type="checkbox"
                          />
                          <span>Shared only</span>
                        </label>
                        <button
                          className="version-filter-button"
                          disabled={isVersionLoading}
                          onClick={() => {
                            applyVersionFilter(section.key, section.address);
                          }}
                          type="button"
                        >
                          {filterButtonLabel}
                        </button>
                      </div>

                      {streamStatusMessage ? (
                        <div aria-live="polite" className="version-stream-status">
                          {isVersionLoading ? (
                            <LoadingIndicator message={streamStatusMessage} />
                          ) : (
                            <span className="empty-state">{streamStatusMessage}</span>
                          )}
                        </div>
                      ) : null}

                      {sectionObjects.length > 0 ? (
                        <ul className="object-list">
                          {sectionObjects.map((object) => {
                            const detailState = objectDetails[object.objectId];
                            const detailData =
                              detailState?.status === "loaded" ? detailState.data : null;
                            const rawFieldsJson =
                              detailData?.fields !== null && detailData?.fields !== undefined
                                ? JSON.stringify(detailData.fields, null, 2)
                                : null;

                            return (
                              <li className="object-row" key={object.objectId}>
                                <details
                                  className="object-panel"
                                  onToggle={(event) => {
                                    if (event.currentTarget.open) {
                                      void loadObjectDetail(object.objectId);
                                    }
                                  }}
                                >
                                  <summary className="object-summary">
                                    <div className="object-summary-main">
                                      <span aria-hidden="true" className="object-arrow">
                                        {"›"}
                                      </span>
                                      <strong className="object-name">
                                        {objectNameFromType(object.objectType)}
                                      </strong>
                                    </div>
                                    <div className="copy-row">
                                      <code className="code-text">{object.objectId}</code>
                                      <CopyButton
                                        copied={copiedKey === `object:${object.objectId}`}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          void copyValue(`object:${object.objectId}`, object.objectId);
                                        }}
                                      />
                                    </div>
                                  </summary>

                                  <div className="object-details">
                                    {detailState?.status === "loading" ? (
                                      <p className="object-status">Loading object data...</p>
                                    ) : null}
                                    {detailState?.status === "error" ? (
                                      <p className="object-status object-status-error">
                                        {detailState.error}
                                      </p>
                                    ) : null}
                                    {detailData && !rawFieldsJson ? (
                                      <p className="object-status">No raw fields.</p>
                                    ) : null}
                                    {rawFieldsJson ? (
                                      <pre className="object-json">{rawFieldsJson}</pre>
                                    ) : null}
                                    {detailData ? (
                                      <details className="object-more-panel">
                                        <summary className="object-more-summary">
                                          Click to show more
                                        </summary>
                                        <dl className="object-meta-list">
                                          <div className="object-meta-row">
                                            <dt>Type</dt>
                                            <dd className="code-text">
                                              {detailData.type ?? object.objectType ?? "unknown"}
                                            </dd>
                                          </div>
                                          <div className="object-meta-row">
                                            <dt>Owner</dt>
                                            <dd>{detailData.owner ?? object.owner}</dd>
                                          </div>
                                          <div className="object-meta-row">
                                            <dt>Version</dt>
                                            <dd>{String(detailData.version ?? object.version)}</dd>
                                          </div>
                                          <div className="object-meta-row">
                                            <dt>Digest</dt>
                                            <dd className="code-text">
                                              {detailData.digest ?? object.digest ?? "n/a"}
                                            </dd>
                                          </div>
                                          <div className="object-meta-row">
                                            <dt>Package</dt>
                                            <dd className="code-text">{object.typePackageId}</dd>
                                          </div>
                                          <div className="object-meta-row">
                                            <dt>Previous Tx</dt>
                                            <dd className="code-text">
                                              {detailData.previousTransaction ?? "n/a"}
                                            </dd>
                                          </div>
                                          <div className="object-meta-row">
                                            <dt>Content Type</dt>
                                            <dd className="code-text">
                                              {detailData.contentType ?? "n/a"}
                                            </dd>
                                          </div>
                                          <div className="object-meta-row">
                                            <dt>Content Data</dt>
                                            <dd>{detailData.contentDataType ?? "n/a"}</dd>
                                          </div>
                                          <div className="object-meta-row">
                                            <dt>Public Transfer</dt>
                                            <dd>
                                              {detailData.hasPublicTransfer === null
                                                ? "n/a"
                                                : String(detailData.hasPublicTransfer)}
                                            </dd>
                                          </div>
                                        </dl>
                                      </details>
                                    ) : null}
                                  </div>
                                </details>
                              </li>
                            );
                          })}
                        </ul>
                      ) : !result.objectsOmitted || hasVersionResults ? (
                        <p className="empty-state">
                          {versionFilterQuery ? "No matching objects." : "No objects."}
                        </p>
                      ) : null}
                      {versionError ? (
                        <p className="object-status object-status-error">{versionError}</p>
                      ) : null}
                    </div>
                  </details>
                );
              })()
            ))}
          </section>
        </>
      ) : null}

      <footer className="app-footer">
        <div className="footer-copy">
          <p className="footer-note">If you want to propose new features, feel free to DM.</p>
        </div>
        <div className="footer-links">
          <a
            aria-label="Message Rashmor on X"
            className="footer-link"
            href="https://x.com/rashmor_eth"
            rel="noreferrer"
            target="_blank"
          >
            <XIcon />
            <span className="sr-only">X</span>
          </a>
          <a
            aria-label="View the project on GitHub"
            className="footer-link"
            href="https://github.com/RASHMOR1/sui-objects-finder"
            rel="noreferrer"
            target="_blank"
          >
            <GitHubIcon />
            <span className="sr-only">GitHub</span>
          </a>
        </div>
      </footer>
    </main>
  );
}
