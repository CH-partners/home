import { collection, addDoc, updateDoc, deleteDoc, doc, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function initSchedule(ctx) {
  const { db, escapeHtml, removeUndefinedDeep, addEditLog, openModal, closeModal, getCurrentUser } = ctx;

  const schedulesColRef = collection(db, "schedules");
  let calendar = null;
  let scheduleUnsubscribe = null;
  let currentScheduleEventId = null;
  let scheduleEvents = [];

function initCalendar() {
  const calendarEl = document.getElementById("calendar");
  if (!calendarEl || calendar) return;

  calendar = new FullCalendar.Calendar(calendarEl, {
  locale: "ko",
  initialView: "dayGridMonth",
  height: "auto",
  headerToolbar: {
    left: "prev,next today",
    center: "title",
    right: "dayGridMonth,timeGridWeek,timeGridDay"
  },
  buttonText: {
    today: "오늘",
    month: "월",
    week: "주",
    day: "일"
  },
  selectable: true,
  editable: false,

  // 하루 일정 3개까지 3줄로 표시
  dayMaxEvents: 3,
  dayMaxEventRows: 3,
  expandRows: true,

  dateClick(info) {
    openScheduleEditor({
      date: info.dateStr,
      startTime: "",
      endTime: "",
      title: "",
      memo: ""
    });
  },

  eventClick(info) {
    const ext = info.event.extendedProps || {};
    openScheduleEditor({
      id: info.event.id,
      title: info.event.title,
      date: ext.date || (info.event.startStr ? info.event.startStr.slice(0, 10) : ""),
      startTime: ext.startTime || "",
      endTime: ext.endTime || "",
      memo: ext.memo || "",
      color: info.event.backgroundColor || "#3b82f6"
    });
  },

  events: []
});

  calendar.render();
}

function mapScheduleDocToEvent(docSnap) {
  const data = docSnap.data() || {};
  const date = data.date || "";
  const startTime = data.startTime || "";
  const endTime = data.endTime || "";

  let start = date;
  let end;
  let allDay = true;

  if (date && startTime) {
    start = `${date}T${startTime}`;
    allDay = false;
  }
  if (date && endTime) {
    end = `${date}T${endTime}`;
  }

  return {
    id: docSnap.id,
    title: data.title || "(제목 없음)",
    start,
    end,
    allDay,
    backgroundColor: data.color || "#3b82f6", // 🔥 추가
    borderColor: data.color || "#3b82f6",     // 🔥 추가
    extendedProps: {
      date,
      startTime,
      endTime,
      memo: data.memo || "",
      writer: data.writer || ""
    }
  };
}

function refreshCalendarEvents() {
  if (!calendar) return;
  calendar.removeAllEvents();
  scheduleEvents.forEach(evt => calendar.addEvent(evt));
}

function subscribeSchedules() {
  if (scheduleUnsubscribe) scheduleUnsubscribe();
  const qRef = query(schedulesColRef, orderBy("date", "asc"));
  scheduleUnsubscribe = onSnapshot(qRef, snap => {
    scheduleEvents = snap.docs.map(mapScheduleDocToEvent);
    refreshCalendarEvents();
  }, error => {
    console.error("스케줄 불러오기 실패:", error);
  });
}

function formatTodayDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function openScheduleEditor(schedule = {}) {
  currentScheduleEventId = schedule.id || null;
  document.getElementById("scheduleModalTitle").textContent = currentScheduleEventId ? "일정 수정" : "일정 등록";
  document.getElementById("scheduleFormTitle").value = schedule.title || "";
  document.getElementById("scheduleFormDate").value = schedule.date || formatTodayDate();
  document.getElementById("scheduleFormStart").value = schedule.startTime || "";
  document.getElementById("scheduleFormEnd").value = schedule.endTime || "";
  document.getElementById("scheduleFormMemo").value = schedule.memo || "";
  document.getElementById("scheduleDeleteBtn").classList.toggle("hidden", !currentScheduleEventId);
  document.getElementById("scheduleColor").value = schedule.color || "#3b82f6";
  openModal("scheduleModal");
}

window.openNewScheduleFromButton = function() {
  openScheduleEditor({ date: formatTodayDate() });
};

window.closeScheduleEditor = function() {
  closeModal("scheduleModal");
};

window.saveScheduleEvent = async function() {
  try {
    const title = document.getElementById("scheduleFormTitle").value.trim();
    const date = document.getElementById("scheduleFormDate").value;
    const startTime = document.getElementById("scheduleFormStart").value;
    const endTime = document.getElementById("scheduleFormEnd").value;
    const memo = document.getElementById("scheduleFormMemo").value.trim();
    const color = document.getElementById("scheduleColor").value;

    if (!title) return alert("일정 제목을 입력하세요.");
    if (!date) return alert("날짜를 입력하세요.");
    if (startTime && endTime && startTime > endTime) return alert("종료 시간이 시작 시간보다 빠를 수 없습니다.");

    const payload = removeUndefinedDeep({
      title,
      date,
      startTime: startTime || "",
      endTime: endTime || "",
      memo,
      color, 
      writer: getCurrentUser()?.email || "anonymous",
      updatedAt: new Date().toISOString()
    });

    if (currentScheduleEventId) {
      await updateDoc(doc(db, "schedules", currentScheduleEventId), payload);
    } else {
      await addDoc(schedulesColRef, {
        ...payload,
        createdAt: new Date().toISOString()
      });
    }
    await addEditLog("스케줄", title, currentScheduleEventId ? "수정" : "등록");
    
    closeModal("scheduleModal");
  } catch (error) {
    console.error("일정 저장 실패:", error);
    alert("일정 저장 실패: " + (error.message || error));
  }
};

window.deleteScheduleEvent = async function() {
  if (!currentScheduleEventId) return;
  if (!confirm("이 일정을 삭제하시겠습니까?")) return;
  try {
    await deleteDoc(doc(db, "schedules", currentScheduleEventId));
    closeModal("scheduleModal");
  } catch (error) {
    console.error("일정 삭제 실패:", error);
    alert("일정 삭제 실패: " + (error.message || error));
  }
};



  return {
    initCalendar,
    subscribeSchedules,
    updateSize() {
      if (calendar) calendar.updateSize();
    }
  };
}
