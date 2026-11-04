(function () {
  "use strict";

  const header = document.getElementById("header");
  const toggle = document.getElementById("menuToggle");
  const nav = document.getElementById("nav");
  const year = document.getElementById("year");

  if (year) year.textContent = new Date().getFullYear();

  function onScroll() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 24);
  }

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  function closeNav() {
    document.body.classList.remove("nav-open");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Buka menu");
    }
  }

  if (toggle) {
    toggle.addEventListener("click", function () {
      const open = document.body.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Tutup menu" : "Buka menu");
    });
  }

  if (nav) {
    nav.addEventListener("click", function (event) {
      if (event.target.tagName === "A") closeNav();
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeNav();
  });

  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    reveals.forEach(function (element) {
      observer.observe(element);
    });
  } else {
    reveals.forEach(function (element) {
      element.classList.add("in");
    });
  }

  async function requestJSON(url, options) {
    const config = Object.assign({}, options);
    const headers = Object.assign(
      { Accept: "application/json" },
      (config.headers || {})
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
      const message =
        (data && data.error) || "Terjadi kesalahan. Silakan coba lagi.";
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return data;
  }

  const projectGrid = document.getElementById("projectGrid");

  function projectCard(project) {
    const card = document.createElement("a");
    card.className = "project";
    card.href = "#kontak";
    card.setAttribute("aria-label", "Lihat proyek " + project.title);

    const media = document.createElement("div");
    media.className = "project-media";

    if (project.imageUrl) {
      const image = document.createElement("img");
      image.src = project.imageUrl;
      image.alt = project.title + (project.category ? " — " + project.category : "");
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", function () {
        image.remove();
        media.classList.add("project-media--empty");
      });
      media.appendChild(image);
    } else {
      media.classList.add("project-media--empty");
    }

    const info = document.createElement("div");
    info.className = "project-info";

    const title = document.createElement("h3");
    title.textContent = project.title;
    info.appendChild(title);

    const meta = document.createElement("span");
    meta.textContent = [project.year, project.category].filter(Boolean).join(" · ");
    info.appendChild(meta);

    card.appendChild(media);
    card.appendChild(info);
    return card;
  }

  async function loadProjects() {
    if (!projectGrid) return;

    try {
      const data = await requestJSON("/api/projects");
      const projects = Array.isArray(data && data.projects) ? data.projects : [];

      if (!projects.length) {
        projectGrid.replaceChildren();
        const empty = document.createElement("p");
        empty.className = "project-empty";
        empty.textContent = "Galeri sedang disiapkan. Sementara itu, ";
        const link = document.createElement("a");
        link.href = "#kontak";
        link.textContent = "ceritakan proyek Anda";
        empty.appendChild(link);
        empty.appendChild(document.createTextNode("."));
        projectGrid.appendChild(empty);
        return;
      }

      projectGrid.replaceChildren.apply(
        projectGrid,
        projects.map(projectCard)
      );
    } catch (error) {
      projectGrid.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "project-empty";
      empty.textContent =
        "Galeri belum bisa dimuat saat ini. Silakan muat ulang halaman atau hubungi kami langsung.";
      projectGrid.appendChild(empty);
    }
  }

  loadProjects();

  const form = document.getElementById("contactForm");
  const note = document.getElementById("formNote");
  const submitButton = document.getElementById("contactSubmit");
  const defaultNote = note ? note.textContent : "";

  function setNote(message, state) {
    if (!note) return;
    note.textContent = message;
    note.className = "form-note" + (state ? " is-" + state : "");
  }

  function setLoading(loading) {
    if (!submitButton) return;
    submitButton.disabled = loading;
    if (loading) {
      submitButton.textContent = "Mengirim…";
    } else {
      submitButton.innerHTML =
        (submitButton.dataset.idleText || "Kirim pesan") +
        ' <span class="arrow">→</span>';
    }
  }

  if (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      const name = form.elements.name.value.trim();
      const contact = form.elements.contact.value.trim();
      const projectType = form.elements.projectType.value;
      const message = form.elements.message.value.trim();
      const website = form.elements.website.value;

      if (name.length < 2) {
        setNote("Nama minimal 2 karakter, ya.", "error");
        form.elements.name.focus();
        return;
      }

      if (contact.length < 5) {
        setNote("Isi nomor atau email yang bisa kami hubungi.", "error");
        form.elements.contact.focus();
        return;
      }

      setLoading(true);
      setNote("Mengirim pesan…", null);

      try {
        await requestJSON("/api/contact", {
          method: "POST",
          body: JSON.stringify({ name, contact, projectType, message, website }),
        });

        form.reset();
        setNote(
          "Terima kasih, " +
            name.split(" ")[0] +
            ". Pesan Anda sudah kami terima dan akan dibalas dalam satu hari kerja.",
          "success"
        );
      } catch (error) {
        setNote(error.message, "error");
      } finally {
        setLoading(false);
      }
    });
  }

  if (note && defaultNote) {
    note.textContent = defaultNote;
  }
})();
