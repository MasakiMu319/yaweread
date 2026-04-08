import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "./App.css";

interface BookItem {
  bookId: string;
  title?: string;
  author?: string;
  cover?: string;
}

interface HighlightItem {
  bookmarkId?: string;
  markText?: string;
  chapterName?: string;
  createTime?: number;
}

interface ReviewItem {
  reviewId?: string;
  content?: string;
  chapterName?: string;
  mdContent?: string;
  createTime?: number;
}

type View = "shelf" | "detail";

// Wait for one weread-data event
function waitForData(): Promise<any> {
  return new Promise((resolve, reject) => {
    let unlisten: UnlistenFn | null = null;
    const timeout = setTimeout(() => {
      unlisten?.();
      reject(new Error("Timeout"));
    }, 15000);

    listen<string>("weread-data", (event) => {
      clearTimeout(timeout);
      unlisten?.();
      try {
        resolve(JSON.parse(event.payload));
      } catch {
        resolve(event.payload);
      }
    }).then((fn) => {
      unlisten = fn;
    });
  });
}

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookItem | null>(null);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [view, setView] = useState<View>("shelf");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("正在启动...");

  // Startup: open hidden weread webview, wait for load, check login
  useEffect(() => {
    (async () => {
      try {
        setStatus("加载微信读书...");
        await invoke("open_weread");
        // Wait for page to load
        await sleep(3000);

        setStatus("检测登录状态...");
        const dataPromise = waitForData();
        await invoke("check_login");
        const result = await dataPromise;

        if (result?.loggedIn) {
          setLoggedIn(true);
          setStatus("");
          await invoke("hide_weread");
        } else {
          // Not logged in: show the weread window for QR scan
          setStatus("请在弹出窗口中扫码登录");
          await invoke("show_login");
          // Start polling for login
          pollLogin();
        }
      } catch (e) {
        console.error("Startup error:", e);
        setStatus("请在弹出窗口中扫码登录");
        await invoke("show_login");
        pollLogin();
      }
    })();
  }, []);

  async function pollLogin() {
    while (true) {
      await sleep(3000);
      try {
        const dataPromise = waitForData();
        await invoke("check_login");
        const result = await dataPromise;
        if (result?.loggedIn) {
          setLoggedIn(true);
          setStatus("");
          await invoke("hide_weread");
          return;
        }
      } catch {
        // Keep polling
      }
    }
  }

  // Load shelf after login
  useEffect(() => {
    if (!loggedIn) return;
    loadShelf();
  }, [loggedIn]);

  async function wereadApi(path: string): Promise<any> {
    const dataPromise = waitForData();
    await invoke("weread_fetch", { apiPath: path });
    return dataPromise;
  }

  const loadShelf = async () => {
    setLoading(true);
    try {
      const data = await wereadApi("/web/shelf/sync");
      const bookList: BookItem[] = [];
      if (data.books) {
        for (const item of data.books) {
          const book = item.book || item;
          if (book.bookId) {
            bookList.push({
              bookId: book.bookId,
              title: book.title || "Unknown",
              author: book.author || "",
              cover: book.cover || "",
            });
          }
        }
      }
      setBooks(bookList);
    } catch (e) {
      console.error("Failed to load shelf:", e);
    } finally {
      setLoading(false);
    }
  };

  const openBookDetail = async (book: BookItem) => {
    setSelectedBook(book);
    setView("detail");
    setLoading(true);

    try {
      const bookmarksData = await wereadApi(`/web/book/bookmarklist?bookId=${book.bookId}`);
      setHighlights(bookmarksData.updated || []);
    } catch (e) {
      console.error("Failed to load bookmarks:", e);
    }

    try {
      const reviewsData = await wereadApi(`/web/review/list?bookId=${book.bookId}&listType=11&mine=1&syncKey=0`);
      const reviewList: ReviewItem[] = (reviewsData.reviews || []).map(
        (r: any) => r.review || r
      );
      setReviews(reviewList);
    } catch (e) {
      console.error("Failed to load reviews:", e);
    }

    setLoading(false);
  };

  const handleLogout = async () => {
    await invoke("logout");
    setLoggedIn(false);
    setUserInfo(null);
    setBooks([]);
    setSelectedBook(null);
    setView("shelf");
  };

  const goBack = () => {
    setView("shelf");
    setSelectedBook(null);
    setHighlights([]);
    setReviews([]);
  };

  if (!loggedIn) {
    return (
      <div className="app">
        <div className="login-page">
          <h2>📚 YaWeRead</h2>
          <p>微信读书英语学习助手</p>
          <p style={{ color: "#999" }}>{status}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>📚 YaWeRead</h1>
        <div className="header-right">
          {userInfo && (
            <div className="user-info">
              {userInfo.avatar && (
                <img className="user-avatar" src={userInfo.avatar} alt="" />
              )}
              <span className="user-name">{userInfo.name || "User"}</span>
            </div>
          )}
          <button className="btn btn-secondary btn-small" onClick={handleLogout}>
            退出
          </button>
        </div>
      </header>

      <div className="main-content">
        {view === "shelf" && (
          <>
            {loading ? (
              <div className="loading">加载书架中...</div>
            ) : books.length === 0 ? (
              <div className="empty">书架为空</div>
            ) : (
              <div className="shelf-grid">
                {books.map((book) => (
                  <div key={book.bookId} className="book-card" onClick={() => openBookDetail(book)}>
                    {book.cover && <img className="book-cover" src={book.cover} alt={book.title} />}
                    <div className="book-info">
                      <div className="book-title">{book.title}</div>
                      <div className="book-author">{book.author}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {view === "detail" && selectedBook && (
          <div className="book-detail">
            <div className="book-detail-header">
              <button className="back-btn" onClick={goBack}>← 返回</button>
              <h2 style={{ fontSize: 18 }}>{selectedBook.title}</h2>
            </div>

            {loading ? (
              <div className="loading">加载中...</div>
            ) : (
              <>
                {highlights.length > 0 && (
                  <div>
                    <div className="section-title">划线 ({highlights.length})</div>
                    <div className="highlight-list">
                      {highlights.map((h, i) => (
                        <div key={h.bookmarkId || i} className="highlight-item">
                          <div className="highlight-text">{h.markText}</div>
                          {h.chapterName && <div className="highlight-chapter">📖 {h.chapterName}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {reviews.length > 0 && (
                  <div>
                    <div className="section-title">笔记 ({reviews.length})</div>
                    <div className="highlight-list">
                      {reviews.map((r, i) => (
                        <div key={r.reviewId || i} className="highlight-item">
                          <div className="highlight-text">{r.content || r.mdContent}</div>
                          {r.chapterName && <div className="highlight-chapter">📖 {r.chapterName}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {highlights.length === 0 && reviews.length === 0 && (
                  <div className="empty">暂无划线和笔记</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default App;
