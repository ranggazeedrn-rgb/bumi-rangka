(function () {
  "use strict";

  const statusLabels = {
    new: "Baru",
    contacted: "Dihubungi",
    closed: "Selesai",
    archived: "Arsip",
  };

  const statusOrder = ["new", "contacted", "closed", "archived"];

  const state = {
    inquiries: [],
    projects: [],
    stats: { total: 0, new: 0, contacted: 0, closed: 0, projects: 0 },
    filter: "all",
    tab: "inquiries",
    editingId: null,
  };

  const els = {
    loading: document.getElementById("loadingView"),
    login: document.getElementById("loginView"),
    dash: document.getElementById("dashView"),
    loginForm: document.getElementById("loginForm"),
    password: document.getElementById("password"),
    loginError: document.getElementById("loginError"),
    loginSubmit: document.getElementById("loginSubmit"),
    defaultPasswordNote: document.getElementById("defaultPasswordNote"),
    logoutBtn: document.getElementById("logoutBtn"),
    statTotal: document.getElementById("statTotal"),
    statNew: document.getElementById("statNew"),
    statContacted: document.getElementById("statContacted"),
    statProjects: document.getElementById("statProjects"),
    tabInquiryCount: document.getElementById("tabInquiryCount"),
    tabProjectCount: document.getElementById("tabProjectCount"),
    tabs: Array.from(document.querySelectorAll(".tab")),
    filters: Array.from(document.querySelectorAll(".filter")),
    inquiryList: document.getElementById("inquiryList"),
    projectList: document.getElementById("projectList"),
    tabInquiries: document.getElementById("tabInquiries"),
    tabProjects: document.getElementById("tabProjects"),
    refreshBtn: document.getElementById("refreshBtn"),
    newProjectBtn: document.getElementById("newProjectBtn"),
    dialog: document.getElementById("projectDialog"),
    projectForm: document.getElementById("projectForm"),
    dialogKicker: document.getElementById("dialogKicker"),
    dialogTitle: document.getElementById("dialogTitle"),
    projectId: document.getElementById("projectId"),
    projectTitle: document.getElementById("projectTitle"),
    projectLocation: document.getElementById("projectLocation"),
    projectYear: document.getElementById("projectYear"),
    projectCategory: document.getElementById("projectCategory"),
    projectSort: document.getElementById("projectSort"),
    projectImage: document.getElementById("projectImage"),
    projectError: document.getElementById("projectError"),
    saveProjectBtn: document.getElementById("saveProjectBtn"),
    closeDialogBtn: document.getElementById("closeDialogBtn"),
    cancelProjectBtn: document.getElementById("cancelProjectBtn"),
    toast: document.getElementById("toast"),
  };

  const dateFormatter = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let toastTimer = null;

  async function requestJSON(url, options) {
    const config = Object.assign({}, options);
    const headers = Object.assign(
      { Accept: "application/json" },
      config.headers || {}
    );
    if (config.body) headers["Content-Type"] = "application/json";
    config.headers = headers;

    const response = await fetch(url, config);
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      const error = new Error(
        (data && data.error) || "Terjadi kesalahan. Silakan coba lagi."
      );
      error.status = response.status;
      throw error;
    }

    return data;
  }

  function showToast(message, type) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.className =
      "toast is-visible" + (type === "error" ? " is-error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.className = "toast";
    }, 3600);
  }

  function showLogin(message) {
    els.loading.hidden = true;
    els.dash.hidden = true;
    els.login.hidden = false;
    els.loginError.textContent = message || "";
    if (els.password) {
      els.password.value = "";
      setTimeout(function () {
        els.password.focus();
      }, 50);
    }
  }

  function showDashboard(me) {
    els.loading.hidden = true;
    els.login.hidden = true;
    els.dash.hidden = false;
    if (els.defaultPasswordNote) {
      els.defaultPasswordNote.hidden = !(me && me.usingDefaultPassword);
    }
  }

  function handleAuthError(error) {
    if (error && error.status === 401) {
      showLogin("Sesi berakhir. Silakan masuk kembali.");
      return true;
    }
    return false;
  }

  function formatDate(value) {
    if (!value) return "";
    const iso = value.indexOf("T") !== -1 ? value : value.replace(" ", "T") + "Z";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return value;
    return dateFormatter.format(date);
  }

  function contactHref(value) {
    if (!value) return null;
    if (value.indexOf("@") !== -1) return "mailto:" + value.trim();
    const digits = value.replace(/[^\d+]/g, "");
    if (!digits) return null;
    let number = digits.replace(/^\+/, "");
    if (number.charAt(0) === "0") number = "62" + number.slice(1);
    return "https://wa.me/" + number;
  }

  function badgeClass(status) {
    return "badge badge--" + (statusLabels[status] ? status : "archived");
  }

  function renderStats() {
    els.statTotal.textContent = String(state.stats.total || 0);
    els.statNew.textContent = String(state.stats.new || 0);
    els.statContacted.textContent = String(state.stats.contacted || 0);
    els.statProjects.textContent = String(state.stats.projects || 0);
    els.tabInquiryCount.textContent = String(state.stats.total || 0);
    els.tabProjectCount.textContent = String(state.stats.projects || 0);
  }

  function emptyState(title, text) {
    const box = document.createElement("div");
    box.className = "empty-state";
    const strong = document.createElement("strong");
    strong.textContent = title;
    box.appendChild(strong);
    const paragraph = document.createElement("span");
    paragraph.textContent = text;
    box.appendChild(paragraph);
    return box;
  }

  function inquiryCard(inquiry) {
    const card = document.createElement("article");
    card.className =
      "inquiry-card" + (inquiry.status === "new" ? " is-new" : "");

    const head = document.createElement("div");
    head.className = "inquiry-head";

    const person = document.createElement("div");
    const name = document.createElement("h3");
    name.className = "inquiry-name";
    name.textContent = inquiry.name;
    person.appendChild(name);

    const href = contactHref(inquiry.contact);
    if (href) {
      const contact = document.createElement("a");
      contact.className = "inquiry-contact";
      contact.href = href;
      contact.target = "_blank";
      contact.rel = "noopener";
      contact.textContent = inquiry.contact;
      person.appendChild(contact);
    } else {
      const contact = document.createElement("span");
      contact.className = "inquiry-contact";
      contact.textContent = inquiry.contact;
      person.appendChild(contact);
    }

    const side = document.createElement("div");
    side.className = "inquiry-side";

    const badge = document.createElement("span");
    badge.className = badgeClass(inquiry.status);
    badge.textContent = statusLabels[inquiry.status] || inquiry.status;
    side.appendChild(badge);

    const date = document.createElement("time");
    date.className = "inquiry-date";
    date.dateTime = inquiry.createdAt || "";
    date.textContent = formatDate(inquiry.createdAt);
    side.appendChild(date);

    head.appendChild(person);
    head.appendChild(side);
    card.appendChild(head);

    const type = document.createElement("p");
    type.className = "inquiry-type";
    type.textContent = inquiry.projectType || "Jenis proyek belum diisi";
    card.appendChild(type);

    const message = document.createElement("p");
    message.className = "inquiry-message";
    message.textContent =
      inquiry.message || "Tidak ada catatan tambahan dari pengirim.";
    card.appendChild(message);

    const actions = document.createElement("div");
    actions.className = "inquiry-actions";

    const select = document.createElement("select");
    select.className = "status-select";
    select.setAttribute("aria-label", "Ubah status pesan dari " + inquiry.name);
    statusOrder.forEach(function (status) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = statusLabels[status];
      if (status === inquiry.status) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener("change", async function () {
      const previous = inquiry.status;
      select.disabled = true;
      try {
        const data = await requestJSON(
          "/api/admin/inquiries/" + inquiry.id,
          {
            method: "PATCH",
            body: JSON.stringify({ status: select.value }),
          }
        );
        if (data.stats) {
          state.stats = data.stats;
        }
        showToast("Status pesan diperbarui.");
        await loadInquiries();
        renderStats();
      } catch (error) {
        if (handleAuthError(error)) return;
        select.value = previous;
        select.disabled = false;
        showToast(error.message, "error");
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-btn";
    remove.textContent = "Hapus pesan";
    remove.setAttribute("aria-label", "Hapus pesan dari " + inquiry.name);
    remove.addEventListener("click", async function () {
      const confirmed = window.confirm(
        "Hapus pesan dari " + inquiry.name + "? Tindakan ini permanen."
      );
      if (!confirmed) return;
      remove.disabled = true;
      try {
        await requestJSON("/api/admin/inquiries/" + inquiry.id, {
          method: "DELETE",
        });
        showToast("Pesan dihapus.");
        await loadInquiries();
        renderStats();
      } catch (error) {
        if (handleAuthError(error)) return;
        remove.disabled = false;
        showToast(error.message, "error");
      }
    });

    actions.appendChild(select);
    actions.appendChild(remove);
    card.appendChild(actions);

    return card;
  }

  function renderInquiries() {
    els.inquiryList.replaceChildren();

    if (!state.inquiries.length) {
      const titles = {
        all: "Belum ada pesan masuk",
        new: "Tidak ada pesan baru",
        contacted: "Belum ada yang dihubungi",
        closed: "Belum ada pesan selesai",
        archived: "Arsip masih kosong",
      };
      els.inquiryList.appendChild(
        emptyState(
          titles[state.filter] || titles.all,
          "Pesan dari formulir kontak akan muncul di sini."
        )
      );
      return;
    }

    state.inquiries.forEach(function (inquiry) {
      els.inquiryList.appendChild(inquiryCard(inquiry));
    });
  }

  function projectCard(project) {
    const card = document.createElement("article");
    card.className = "admin-project-card";

    const media = document.createElement("div");
    media.className = "admin-project-media";

    if (project.imageUrl) {
      const image = document.createElement("img");
      image.src = project.imageUrl;
      image.alt = project.title;
      image.loading = "lazy";
      image.addEventListener("error", function () {
        image.remove();
        const placeholder = document.createElement("div");
        placeholder.className = "media-placeholder";
        placeholder.textContent = "Tanpa gambar";
        media.appendChild(placeholder);
      });
      media.appendChild(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "media-placeholder";
      placeholder.textContent = "Tanpa gambar";
      media.appendChild(placeholder);
    }

    const body = document.createElement("div");
    body.className = "admin-project-body";

    const title = document.createElement("h3");
    title.textContent = project.title;
    body.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "project-meta";
    meta.textContent = [project.location, project.year, project.category]
      .filter(Boolean)
      .join(" · ");
    body.appendChild(meta);

    const order = document.createElement("span");
    order.className = "project-order";
    order.textContent = "Urutan tampil: " + project.sortOrder;
    body.appendChild(order);

    const actions = document.createElement("div");
    actions.className = "admin-project-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "small-btn";
    edit.textContent = "Ubah";
    edit.addEventListener("click", function () {
      openProjectDialog(project);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "small-btn danger";
    remove.textContent = "Hapus";
    remove.addEventListener("click", async function () {
      const confirmed = window.confirm(
        'Hapus proyek "' + project.title + '"? Proyek akan hilang dari situs.'
      );
      if (!confirmed) return;
      remove.disabled = true;
      try {
        await requestJSON("/api/admin/projects/" + project.id, {
          method: "DELETE",
        });
        showToast("Proyek dihapus.");
        await loadProjects();
        renderStats();
      } catch (error) {
        if (handleAuthError(error)) return;
        remove.disabled = false;
        showToast(error.message, "error");
      }
    });

    actions.appendChild(edit);
    actions.appendChild(remove);
    body.appendChild(actions);

    card.appendChild(media);
    card.appendChild(body);
    return card;
  }

  function renderProjects() {
    els.projectList.replaceChildren();

    if (!state.projects.length) {
      els.projectList.appendChild(
        emptyState(
          "Belum ada proyek",
          "Tambahkan proyek pertama lewat tombol “Proyek baru”."
        )
      );
      return;
    }

    state.projects.forEach(function (project) {
      els.projectList.appendChild(projectCard(project));
    });
  }

  async function loadInquiries() {
    try {
      const data = await requestJSON(
        "/api/admin/inquiries?status=" + encodeURIComponent(state.filter)
      );
      state.inquiries = data.inquiries || [];
      if (data.stats) state.stats = data.stats;
      renderStats();
      renderInquiries();
    } catch (error) {
      if (handleAuthError(error)) return;
      els.inquiryList.replaceChildren(
        emptyState("Gagal memuat pesan", error.message)
      );
    }
  }

  async function loadProjects() {
    try {
      const data = await requestJSON("/api/admin/projects");
      state.projects = data.projects || [];
      if (data.stats) state.stats = data.stats;
      renderStats();
      renderProjects();
    } catch (error) {
      if (handleAuthError(error)) return;
      els.projectList.replaceChildren(
        emptyState("Gagal memuat proyek", error.message)
      );
    }
  }

  async function loadAll() {
    await Promise.all([loadInquiries(), loadProjects()]);
  }

  function switchTab(tab) {
    state.tab = tab;
    els.tabs.forEach(function (button) {
      const active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    els.tabInquiries.hidden = tab !== "inquiries";
    els.tabProjects.hidden = tab !== "projects";
  }

  function openProjectDialog(project) {
    state.editingId = project ? project.id : null;
    els.dialogKicker.textContent = project ? "Ubah proyek" : "Proyek baru";
    els.dialogTitle.textContent = project ? "Ubah proyek" : "Tambah proyek";
    els.projectError.textContent = "";
    els.projectId.value = project ? String(project.id) : "";
    els.projectTitle.value = project ? project.title : "";
    els.projectLocation.value = project ? project.location : "";
    els.projectYear.value = project ? project.year : "";
    els.projectCategory.value = project ? project.category : "";
    els.projectSort.value = project ? String(project.sortOrder) : "0";
    els.projectImage.value = project ? project.imageUrl : "";
    els.dialog.showModal();
    setTimeout(function () {
      els.projectTitle.focus();
    }, 60);
  }

  function closeProjectDialog() {
    if (els.dialog.open) els.dialog.close();
  }

  function setSaving(saving) {
    els.saveProjectBtn.disabled = saving;
    els.saveProjectBtn.textContent = saving ? "Menyimpan…" : "Simpan proyek";
  }

  els.loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    els.loginError.textContent = "";
    els.loginSubmit.disabled = true;
    els.loginSubmit.textContent = "Memeriksa…";

    try {
      await requestJSON("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: els.password.value }),
      });
      els.password.value = "";
      const me = await requestJSON("/api/admin/me");
      showDashboard(me);
      await loadAll();
      showToast("Selamat datang kembali.");
    } catch (error) {
      els.loginError.textContent = error.message;
      els.password.focus();
    } finally {
      els.loginSubmit.disabled = false;
      els.loginSubmit.innerHTML = 'Masuk <span class="arrow">→</span>';
    }
  });

  els.logoutBtn.addEventListener("click", async function () {
    els.logoutBtn.disabled = true;
    try {
      await requestJSON("/api/admin/logout", { method: "POST" });
    } catch (error) {
      if (!handleAuthError(error)) {
        showToast(error.message, "error");
      }
    } finally {
      els.logoutBtn.disabled = false;
      state.inquiries = [];
      state.projects = [];
      showLogin("");
    }
  });

  els.tabs.forEach(function (button) {
    button.addEventListener("click", function () {
      switchTab(button.dataset.tab);
    });
  });

  els.filters.forEach(function (button) {
    button.addEventListener("click", function () {
      state.filter = button.dataset.status;
      els.filters.forEach(function (item) {
        item.classList.toggle("is-active", item === button);
      });
      loadInquiries();
    });
  });

  els.refreshBtn.addEventListener("click", async function () {
    els.refreshBtn.disabled = true;
    els.refreshBtn.textContent = "Memuat…";
    await loadAll();
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "Muat ulang";
    showToast("Data dimuat ulang.");
  });

  els.newProjectBtn.addEventListener("click", function () {
    openProjectDialog(null);
  });

  els.closeDialogBtn.addEventListener("click", closeProjectDialog);
  els.cancelProjectBtn.addEventListener("click", closeProjectDialog);

  els.dialog.addEventListener("click", function (event) {
    if (event.target === els.dialog) closeProjectDialog();
  });

  els.projectForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    els.projectError.textContent = "";

    const title = els.projectTitle.value.trim();
    if (title.length < 2) {
      els.projectError.textContent = "Judul proyek minimal 2 karakter.";
      els.projectTitle.focus();
      return;
    }

    const payload = {
      title: title,
      location: els.projectLocation.value.trim(),
      year: els.projectYear.value.trim(),
      category: els.projectCategory.value.trim(),
      sortOrder: Number(els.projectSort.value) || 0,
      imageUrl: els.projectImage.value.trim(),
    };

    setSaving(true);

    try {
      if (state.editingId) {
        await requestJSON("/api/admin/projects/" + state.editingId, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        showToast("Proyek diperbarui.");
      } else {
        await requestJSON("/api/admin/projects", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        showToast("Proyek baru ditambahkan.");
      }
      closeProjectDialog();
      await loadProjects();
      renderStats();
    } catch (error) {
      if (handleAuthError(error)) {
        closeProjectDialog();
        return;
      }
      els.projectError.textContent = error.message;
    } finally {
      setSaving(false);
    }
  });

  async function boot() {
    try {
      const me = await requestJSON("/api/admin/me");
      showDashboard(me);
      await loadAll();
    } catch (error) {
      const message =
        error.status === 401
          ? ""
          : "Panel tidak bisa dimuat. Periksa koneksi lalu muat ulang.";
      showLogin(message);
    }
  }

  boot();
})();
