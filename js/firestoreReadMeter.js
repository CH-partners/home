// Firestore Document Read 계측기.
//
// 그룹리뷰 모듈들은 firebase-firestore.js 대신 이 파일에서 getDoc/getDocs/onSnapshot을 가져온다.
// 원본 함수를 그대로 감싸기만 하므로 동작은 바뀌지 않고 호출 횟수와 문서 수만 기록한다.
//
// 콘솔 사용법:
//   groupReviewReadMeter.report()  현재까지 누적된 read를 표로 출력
//   groupReviewReadMeter.reset()   0으로 초기화 (Before/After 비교 시작점)
//   groupReviewReadMeter.watch()   5초마다 자동 출력 (다시 부르면 중지)
import {
  getDoc as firebaseGetDoc,
  getDocs as firebaseGetDocs,
  onSnapshot as firebaseOnSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const stats = {
  startedAt: Date.now(),
  getDoc: { calls: 0, docs: 0 },
  getDocs: { calls: 0, docs: 0 },
  snapshot: { listeners: 0, events: 0, docs: 0 },
  byPath: new Map()
};

let watchTimer = null;

// 문서 경로에서 ID를 걷어내 "groupReviewProjects/{id}/sheets/{id}" 형태로 묶는다.
function pathPattern(path) {
  return String(path || "unknown")
    .split("/")
    .map((segment, index) => (index % 2 === 1 ? "{id}" : segment))
    .join("/");
}

function refPath(target) {
  if (!target) return "unknown";
  if (typeof target.path === "string") return target.path;
  // Query에는 path가 없고 _query 내부에만 있으므로 컬렉션 참조를 통해 얻는다.
  if (target._query?.path?.segments) return target._query.path.segments.join("/");
  return "unknown";
}

function record(kind, target, docs) {
  const bucket = stats[kind];
  if (kind === "snapshot") {
    bucket.events += 1;
  } else {
    bucket.calls += 1;
  }
  bucket.docs += docs;

  const key = `${kind} ${pathPattern(refPath(target))}`;
  const entry = stats.byPath.get(key) || { calls: 0, docs: 0 };
  entry.calls += 1;
  entry.docs += docs;
  stats.byPath.set(key, entry);
}

export function getDoc(reference, ...rest) {
  return firebaseGetDoc(reference, ...rest).then(snapshot => {
    record("getDoc", reference, snapshot.exists() ? 1 : 0);
    return snapshot;
  });
}

export function getDocs(query, ...rest) {
  return firebaseGetDocs(query, ...rest).then(snapshot => {
    record("getDocs", query, snapshot.size);
    return snapshot;
  });
}

// onSnapshot(ref, onNext, onError, onCompletion) 형태만 계측하고
// options 객체를 끼운 다른 오버로드는 그대로 통과시킨다.
export function onSnapshot(reference, ...args) {
  if (typeof args[0] !== "function") {
    return firebaseOnSnapshot(reference, ...args);
  }

  const [onNext, ...others] = args;
  stats.snapshot.listeners += 1;

  const countedOnNext = snapshot => {
    // Firestore는 리스너에 실제로 전달된 문서만 과금한다.
    // 최초 스냅샷은 전체 문서, 이후에는 변경된 문서만 docChanges에 담긴다.
    const docs = typeof snapshot?.docChanges === "function"
      ? snapshot.docChanges().length
      : 1;
    record("snapshot", reference, docs);
    return onNext(snapshot);
  };

  const unsubscribe = firebaseOnSnapshot(reference, countedOnNext, ...others);
  return () => {
    stats.snapshot.listeners -= 1;
    return unsubscribe();
  };
}

function totalDocs() {
  return stats.getDoc.docs + stats.getDocs.docs + stats.snapshot.docs;
}

function report() {
  const minutes = (Date.now() - stats.startedAt) / 60000;
  const rows = [...stats.byPath.entries()]
    .sort((a, b) => b[1].docs - a[1].docs)
    .map(([key, value]) => ({ 경로: key, 호출: value.calls, 문서: value.docs }));

  console.group(`[그룹리뷰 Read 계측] ${minutes.toFixed(1)}분간 문서 ${totalDocs()}건`);
  console.log(
    `getDoc ${stats.getDoc.calls}회/${stats.getDoc.docs}건 · ` +
    `getDocs ${stats.getDocs.calls}회/${stats.getDocs.docs}건 · ` +
    `snapshot ${stats.snapshot.events}회/${stats.snapshot.docs}건 · ` +
    `열린 리스너 ${stats.snapshot.listeners}개`
  );
  console.table(rows);
  console.groupEnd();

  return {
    minutes: Number(minutes.toFixed(2)),
    totalDocs: totalDocs(),
    getDoc: { ...stats.getDoc },
    getDocs: { ...stats.getDocs },
    snapshot: { ...stats.snapshot },
    byPath: rows
  };
}

function reset() {
  stats.startedAt = Date.now();
  stats.getDoc = { calls: 0, docs: 0 };
  stats.getDocs = { calls: 0, docs: 0 };
  // 열린 리스너 수는 실제 구독 상태이므로 초기화하지 않는다.
  stats.snapshot = { listeners: stats.snapshot.listeners, events: 0, docs: 0 };
  stats.byPath.clear();
  console.log("[그룹리뷰 Read 계측] 초기화했습니다.");
}

function watch(seconds = 5) {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
    console.log("[그룹리뷰 Read 계측] 자동 출력을 멈췄습니다.");
    return;
  }
  watchTimer = setInterval(report, seconds * 1000);
  console.log(`[그룹리뷰 Read 계측] ${seconds}초마다 출력합니다. 멈추려면 다시 watch()를 부르세요.`);
}

window.groupReviewReadMeter = { report, reset, watch };
