export function initSchedule(ctx = {}) {
  const { openModal, closeModal } = ctx;

  const API_ROOT = "/api/v1";
  let calendar = null;
  let currentScheduleEventId = null;
  let scheduleEvents = [];
  let refreshTimer = null;

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers["Content-Type"] = "application/json; charset=utf-8";
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers,
      credentials: "include"
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.detail || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function publishStatus(status) {
    const detail = {
      count: Number(status?.count || 0),
      migration_complete: status?.migration_complete === true
    };
    window.dispatchEvent(new CustomEvent("local-schedule-status", { detail }));
    return detail;
  }

  async function getScheduleStatus() {
    return publishStatus(await api("/schedules/status"));
  }

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

  function normalizeTime(value) {
    return String(value || "").slice(0, 5);
  }

  function mapScheduleToEvent(item) {
    const date = String(item.date || "");
    const startTime = normalizeTime(item.start_time);
    const endTime = normalizeTime(item.end_time);

    let start = date;
    let end;
    let allDay = true;

    if (date && startTime) {
      start = `${date}T${startTime}`;
      allDay = false;
    }
    if (date && endTime) end = `${date}T${endTime}`;

    return {
      id: item.id,
      title: item.title || "(제목 없음)",
      start,
      end,
      allDay,
      backgroundColor: item.color || "#3b82f6",
      borderColor: item.color || "#3b82f6",
      extendedProps: {
        date,
        startTime,
        endTime,
        memo: item.memo || "",
        writer: item.writer_email || ""
      }
    };
  }

  function refreshCalendarEvents() {
    if (!calendar) return;
    calendar.removeAllEvents();
    scheduleEvents.forEach(evt => calendar.addEvent(evt));
  }

  async function loadSchedules() {
    await getScheduleStatus();
    let rows = await api("/schedules");
    rows = Array.isArray(rows) ? rows : [];

    scheduleEvents = rows.map(mapScheduleToEvent);
    refreshCalendarEvents();
    return scheduleEvents;
  }

  function subscribeSchedules() {
    void loadSchedules().catch(error => {
      if (error.status !== 401) console.error("스케줄 불러오기 실패:", error);
    });
  }

  function scheduleRefresh(delay = 0) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void loadSchedules().catch(error => {
        if (error.status !== 401) console.error("스케줄 새로고침 실패:", error);
      });
    }, delay);
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
    openModal?.("scheduleModal");
  }

  window.openNewScheduleFromButton = function() {
    openScheduleEditor({ date: formatTodayDate() });
  };

  window.closeScheduleEditor = function() {
    closeModal?.("scheduleModal");
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

      const payload = {
        title,
        date,
        start_time: startTime || null,
        end_time: endTime || null,
        memo,
        color
      };

      if (currentScheduleEventId) {
        await api(`/schedules/${encodeURIComponent(currentScheduleEventId)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
      } else {
        await api("/schedules", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }

      closeModal?.("scheduleModal");
      currentScheduleEventId = null;
      scheduleRefresh(0);
    } catch (error) {
      console.error("일정 저장 실패:", error);
      alert("일정 저장 실패: " + (error.message || error));
    }
  };

  window.deleteScheduleEvent = async function() {
    if (!currentScheduleEventId) return;
    if (!confirm("이 일정을 삭제하시겠습니까?")) return;
    try {
      await api(`/schedules/${encodeURIComponent(currentScheduleEventId)}`, { method: "DELETE" });
      closeModal?.("scheduleModal");
      currentScheduleEventId = null;
      scheduleRefresh(0);
    } catch (error) {
      console.error("일정 삭제 실패:", error);
      alert("일정 삭제 실패: " + (error.message || error));
    }
  };

  document.addEventListener("submit", event => {
    if (event.target?.matches?.("#grv2LoginForm,#allocationLoginForm")) {
      scheduleRefresh(350);
      scheduleRefresh(900);
    }
  }, true);

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#grv2Logout")) scheduleRefresh(300);
  }, true);

  return {
    initCalendar,
    subscribeSchedules,
    refresh: () => scheduleRefresh(0),
    updateSize() {
      if (calendar) calendar.updateSize();
    }
  };
}