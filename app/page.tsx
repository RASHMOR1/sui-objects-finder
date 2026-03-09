"use client";

import {
  FormEvent,
  type MouseEventHandler,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

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

const NETWORKS: NetworkName[] = ["testnet", "mainnet"];
const THEME_STORAGE_KEY = "sui-object-finder-theme";
const VERSION_OBJECT_PAGE_SIZE = 10;

type VersionObjectPage = {
  objects: LiveObjectRow[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

type VersionObjectState = {
  status: "loading" | "loaded" | "error";
  pages: VersionObjectPage[];
  currentPage: number;
  error: string | null;
};

function normalizeVersionFilter(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function objectJsonContainsQuery(value: unknown, query: string): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(query);
  }

  if (Array.isArray(value)) {
    return value.some((item) => objectJsonContainsQuery(item, query));
  }

  if (typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) => key.toLowerCase().includes(query) || objectJsonContainsQuery(item, query),
    );
  }

  return false;
}

function objectMatchesVersionFilter(object: LiveObjectRow, query: string | null): boolean {
  if (!query) {
    return true;
  }

  return objectJsonContainsQuery(object.contentsJson, query.toLowerCase());
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

export default function HomePage() {
  const [packageId, setPackageId] = useState("");
  const [network, setNetwork] = useState<NetworkName>("testnet");
  const [resultNetwork, setResultNetwork] = useState<NetworkName | null>(null);
  const [sharedOnly, setSharedOnly] = useState(true);
  const [resultSharedOnly, setResultSharedOnly] = useState<boolean | null>(null);
  const [exactPackageOnly, setExactPackageOnly] = useState(false);
  const [result, setResult] = useState<LiveObjectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof document === "undefined") {
      return "dark";
    }

    const currentTheme = document.documentElement.dataset.theme;
    return currentTheme === "light" || currentTheme === "dark" ? currentTheme : "dark";
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [objectDetails, setObjectDetails] = useState<Record<string, ObjectDetailState>>({});
  const [versionFilterInputs, setVersionFilterInputs] = useState<Record<string, string>>({});
  const [versionFilterQueries, setVersionFilterQueries] = useState<Record<string, string | null>>(
    {},
  );
  const [versionObjects, setVersionObjects] = useState<Record<string, VersionObjectState>>({});
  const [isPending, startTransition] = useTransition();
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

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
        return count + state.pages.reduce((pageCount, page) => pageCount + page.objects.length, 0);
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
    setError(null);

    const response = await fetch("/api/live-objects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        packageId,
        network,
        sharedOnly,
        exactPackageOnly,
      }),
    });

    const payload = (await response.json()) as LiveObjectResult | { error: string };

    if (!response.ok || "error" in payload) {
      setResult(null);
      setResultNetwork(null);
      setResultSharedOnly(null);
      setObjectDetails({});
      setVersionFilterInputs({});
      setVersionFilterQueries({});
      setVersionObjects({});
      setError("error" in payload ? payload.error : "Search failed.");
      return;
    }

    setObjectDetails({});
    setVersionFilterInputs({});
    setVersionFilterQueries({});
    setVersionObjects({});
    setResultNetwork(network);
    setResultSharedOnly(sharedOnly);
    setResult(payload);
  }

  function setCurrentVersionPage(sectionKey: string, pageIndex: number) {
    setVersionObjects((current) => {
      const existing = current[sectionKey];
      if (!existing || pageIndex < 0 || pageIndex >= existing.pages.length) {
        return current;
      }

      return {
        ...current,
        [sectionKey]: {
          ...existing,
          status: existing.status === "error" ? "loaded" : existing.status,
          currentPage: pageIndex,
          error: null,
        },
      };
    });
  }

  function applyVersionFilter(sectionKey: string, versionPackageId: string) {
    const nextQuery = normalizeVersionFilter(versionFilterInputs[sectionKey] ?? "");

    setVersionFilterQueries((current) => ({
      ...current,
      [sectionKey]: nextQuery,
    }));

    if (!result?.objectsOmitted) {
      return;
    }

    setVersionObjects((current) => {
      const nextState = { ...current };
      delete nextState[sectionKey];
      return nextState;
    });

    void loadVersionObjects(sectionKey, versionPackageId, 0, {
      forceReset: true,
      objectQuery: nextQuery,
    });
  }

  async function loadVersionObjects(
    sectionKey: string,
    versionPackageId: string,
    pageIndex: number,
    options?: {
      forceReset?: boolean;
      objectQuery?: string | null;
    },
  ) {
    const existing = options?.forceReset ? undefined : versionObjects[sectionKey];
    if (existing?.status === "loading") {
      return;
    }

    if (existing && pageIndex < existing.pages.length) {
      setCurrentVersionPage(sectionKey, pageIndex);
      return;
    }

    const nextPageIndex = existing?.pages.length ?? 0;
    if (pageIndex !== nextPageIndex) {
      return;
    }

    const previousPage = nextPageIndex > 0 ? existing?.pages[nextPageIndex - 1] : null;
    const cursor = previousPage?.nextCursor ?? null;
    if (nextPageIndex > 0 && !cursor) {
      return;
    }

    const objectQuery = options?.objectQuery ?? versionFilterQueries[sectionKey] ?? null;
    const existingPages = existing?.pages ?? [];
    const currentPage = existing?.currentPage ?? 0;

    setVersionObjects((current) => ({
      ...current,
      [sectionKey]: {
        status: "loading",
        pages: existingPages,
        currentPage,
        error: null,
      },
    }));

    const response = await fetch("/api/version-objects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        packageId: versionPackageId,
        network: resultNetwork ?? network,
        cursor,
        objectQuery,
        sharedOnly: resultSharedOnly ?? sharedOnly,
        pageSize: VERSION_OBJECT_PAGE_SIZE,
      }),
    });

    const payload = (await response.json()) as VersionObjectsResult | { error: string };

    if (!response.ok || "error" in payload) {
      setVersionObjects((current) => ({
        ...current,
        [sectionKey]: {
          status: "error",
          pages: existingPages,
          currentPage,
          error: "error" in payload ? payload.error : "Failed to load version objects.",
        },
      }));
      return;
    }

    setVersionObjects((current) => ({
      ...current,
      [sectionKey]: {
        status: "loaded",
        pages: [
          ...existingPages,
          {
            objects: payload.objects,
            nextCursor: payload.nextCursor,
            hasNextPage: payload.hasNextPage,
          },
        ],
        currentPage: pageIndex,
        error: null,
      },
    }));
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

    const payload = (await response.json()) as ObjectDataResult | { error: string };

    if (!response.ok || "error" in payload) {
      setObjectDetails((current) => ({
        ...current,
        [objectId]: {
          status: "error",
          error: "error" in payload ? payload.error : "Failed to load object data.",
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
    startTransition(() => {
      void runSearch();
    });
  }

  function onToggleTheme() {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <span className="brand">Sui Objects</span>
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

            <select
              className="search-select"
              name="network"
              onChange={(event) => setNetwork(event.target.value as NetworkName)}
              value={network}
            >
              {NETWORKS.map((networkOption) => (
                <option key={networkOption} value={networkOption}>
                  {networkOption}
                </option>
              ))}
            </select>

            <button
              className={`search-button${isPending ? " is-loading" : ""}`}
              disabled={isPending}
              type="submit"
            >
              <span className="search-button-text">{isPending ? "Searching" : "Search"}</span>
              <span aria-hidden="true" className="search-button-spinner" />
            </button>
          </div>

          <div className="search-options">
            <label className="search-option">
              <input
                checked={sharedOnly}
                onChange={(event) => setSharedOnly(event.target.checked)}
                type="checkbox"
              />
              <span>Shared only</span>
            </label>

            <label className="search-option">
              <input
                checked={exactPackageOnly}
                onChange={(event) => setExactPackageOnly(event.target.checked)}
                type="checkbox"
              />
              <span>Exact only</span>
            </label>
          </div>
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
              <strong>{resultNetwork ?? network}</strong>
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
                ? `${result.objectsOmittedReason} Load versions individually below, 10 objects at a time.`
                : "Object scan skipped. Load versions individually below, 10 objects at a time."}
            </section>
          ) : null}

          <section className="version-list">
            {versionSections.map((section) => (
              (() => {
                const versionObjectState = versionObjects[section.key];
                const versionFilterInput = versionFilterInputs[section.key] ?? "";
                const versionFilterQuery = versionFilterQueries[section.key] ?? null;
                const currentPageIndex = versionObjectState?.currentPage ?? 0;
                const currentPage = versionObjectState?.pages[currentPageIndex] ?? null;
                const loadedPageCount = versionObjectState?.pages.length ?? 0;
                const lastLoadedPage =
                  loadedPageCount > 0 ? versionObjectState?.pages[loadedPageCount - 1] ?? null : null;
                const nextPageIndex = loadedPageCount;
                const nextPageNumber = nextPageIndex + 1;
                const baseSectionObjects = result.objectsOmitted ? currentPage?.objects ?? [] : section.objects;
                const sectionObjects = result.objectsOmitted
                  ? baseSectionObjects
                  : baseSectionObjects.filter((object) =>
                      objectMatchesVersionFilter(object, versionFilterQuery),
                    );
                const isVersionLoading = versionObjectState?.status === "loading";
                const versionError =
                  versionObjectState?.status === "error" ? versionObjectState.error : null;
                const hasNextPage = lastLoadedPage?.hasNextPage ?? false;
                const canStartVersionLoad = result.objectsOmitted && loadedPageCount === 0 && !isVersionLoading;
                const canLoadMore = result.objectsOmitted && loadedPageCount > 0 && hasNextPage && !isVersionLoading;
                const sectionCountLabel =
                  result.objectsOmitted && loadedPageCount > 0
                    ? `Page ${currentPageIndex + 1}`
                    : isVersionLoading
                      ? loadedPageCount > 0
                        ? `Loading page ${nextPageNumber}`
                        : "Loading page 1"
                      : result.objectsOmitted
                        ? "Not loaded"
                        : `${sectionObjects.length} objects`;
                const loadButtonLabel = isVersionLoading
                  ? loadedPageCount > 0
                    ? `Loading page ${nextPageNumber}...`
                    : "Loading page 1..."
                  : loadedPageCount > 0
                    ? `${nextPageNumber}`
                    : "1";

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
                        <button
                          className="version-filter-button"
                          onClick={() => {
                            applyVersionFilter(section.key, section.address);
                          }}
                          type="button"
                        >
                          Filter
                        </button>
                      </div>

                      {result.objectsOmitted && loadedPageCount === 0 ? (
                        <div className="version-load-row">
                          <span className="empty-state">Historical object scan skipped.</span>
                          <button
                            className={`load-version-button${isVersionLoading ? " is-loading" : ""}`}
                            disabled={!canStartVersionLoad}
                            onClick={() => {
                              void loadVersionObjects(section.key, section.address, 0);
                            }}
                            type="button"
                          >
                            {versionError && !isVersionLoading ? "Retry page 1" : `Load page ${loadButtonLabel}`}
                          </button>
                        </div>
                      ) : sectionObjects.length === 0 ? (
                        <p className="empty-state">No objects.</p>
                      ) : (
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
                                        <dd className="code-text">{detailData.contentType ?? "n/a"}</dd>
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
                      )}
                      {result.objectsOmitted && loadedPageCount > 0 ? (
                        <div className="version-pagination">
                          <div className="page-list">
                            {versionObjectState?.pages.map((_, pageIndex) => (
                              <button
                                className={`page-chip${pageIndex === currentPageIndex ? " is-active" : ""}`}
                                key={`${section.key}:page:${pageIndex + 1}`}
                                onClick={() => {
                                  setCurrentVersionPage(section.key, pageIndex);
                                }}
                                type="button"
                              >
                                {pageIndex + 1}
                              </button>
                            ))}
                            {hasNextPage ? (
                              <button
                                className={`page-chip page-chip-next${isVersionLoading ? " is-loading" : ""}`}
                                disabled={!canLoadMore}
                                onClick={() => {
                                  void loadVersionObjects(section.key, section.address, nextPageIndex);
                                }}
                                type="button"
                              >
                                {versionError && !isVersionLoading ? `${nextPageNumber}` : loadButtonLabel}
                              </button>
                            ) : null}
                          </div>
                          <span className="empty-state">
                            Showing {sectionObjects.length} objects on page {currentPageIndex + 1}.
                          </span>
                        </div>
                      ) : null}
                      {result.objectsOmitted &&
                      loadedPageCount > 0 &&
                      !hasNextPage &&
                      currentPageIndex === loadedPageCount - 1 ? (
                        <p className="empty-state">Last page.</p>
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
    </main>
  );
}
