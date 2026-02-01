const initNavExpandables = () => {
  const buttons = document.querySelectorAll("natural-sidebar nav menu > button");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const parentMenu = button.closest("menu");
      if (!parentMenu) {
        return;
      }
      const expanded = parentMenu.getAttribute("aria-expanded");
      const nextState = expanded === "true" ? "false" : "true";
      parentMenu.setAttribute("aria-expanded", nextState);
      button.setAttribute("aria-expanded", nextState);
    });
  });
};

const initSubjectSelector = () => {
  const subjectTrigger = document.getElementById("subject-trigger");
  const subjectMenu = document.getElementById("subject-menu");

  if (!subjectTrigger || !subjectMenu) {
    return;
  }

  const options = subjectMenu.querySelectorAll("natural-subject-option");
  const triggerIcon = subjectTrigger.querySelector("i:first-child");
  const initialSelected =
    subjectMenu.querySelector("natural-subject-option[data-selected='true']");
  let lastSubjectDetail = {
    value: initialSelected?.getAttribute("data-value") ?? "",
    label:
      initialSelected?.querySelector("strong")?.textContent ??
    subjectTrigger.querySelector("strong")?.textContent ??
    "",
  };

  if (triggerIcon && initialSelected) {
    const initialIcon = initialSelected.querySelector("i:first-child");
    if (initialIcon) {
      triggerIcon.className = initialIcon.className;
    }
  }

  const closeMenu = () => {
    subjectMenu.classList.remove("open");
    subjectTrigger.setAttribute("aria-expanded", "false");
  };

  const toggleMenu = () => {
    const isOpen = subjectMenu.classList.contains("open");
    subjectMenu.classList.toggle("open", !isOpen);
    subjectTrigger.setAttribute("aria-expanded", String(!isOpen));
  };

  subjectTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu();
  });

  document.addEventListener("click", (event) => {
    if (
      !subjectMenu.contains(event.target) &&
      !subjectTrigger.contains(event.target)
    ) {
      closeMenu();
    }
  });

  options.forEach((option) => {
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      options.forEach((opt) => opt.removeAttribute("data-selected"));
      option.setAttribute("data-selected", "true");
      const labelValue =
        option.querySelector("strong")?.textContent ||
        option.getAttribute("data-value");
      const selectedIcon = option.querySelector("i:first-child");
      if (triggerIcon && selectedIcon) {
        triggerIcon.className = selectedIcon.className;
      }
      const triggerLabel = subjectTrigger.querySelector("strong");
      if (triggerLabel) {
        triggerLabel.textContent = labelValue;
      }
      closeMenu();
      const subjectValue = option.getAttribute("data-value") ?? labelValue;
      const containerId =
        subjectTrigger.closest("natural-subjects")?.id ??
        subjectTrigger.getAttribute("data-subject-container-id") ??
        null;
      const changeEvent = new CustomEvent("natural-subject-change", {
        detail: {
          previousValue: lastSubjectDetail.value,
          previousLabel: lastSubjectDetail.label,
          value: subjectValue,
          label: labelValue,
          containerId,
        },
      });
      lastSubjectDetail = { value: subjectValue, label: labelValue };
      subjectTrigger.dispatchEvent(changeEvent);
    });
  });
};

const initTabs = () => {
  document.querySelectorAll("natural-tabs").forEach((tabs) => {
    let header = tabs.querySelector("natural-tabs-header");
    if (!header) {
      header = document.createElement("natural-tabs-header");
      tabs.insertBefore(header, tabs.firstElementChild);
    }
    header.innerHTML = "";
    const panels = Array.from(tabs.querySelectorAll("natural-tab-panel"));
    let foundActive = false;
    panels.forEach((panel, index) => {
      const labelElement = panel.querySelector(":scope > header");
      const label = labelElement?.textContent?.trim() || `Tab ${index + 1}`;
      const button = document.createElement("natural-tab-button");
      button.textContent = label;
      button.setAttribute("role", "tab");
      button.setAttribute("data-tab-target", panel.id);
      const panelIsActive = panel.hasAttribute("data-active");
      if (panelIsActive && !foundActive) {
        foundActive = true;
        button.classList.add("active");
        button.setAttribute("aria-selected", "true");
        panel.classList.add("active");
      } else {
        panel.classList.remove("active");
        button.setAttribute("aria-selected", "false");
      }
      header.appendChild(button);
    });
    if (!foundActive && panels.length) {
      const firstPanel = panels[0];
      const firstButton = header.querySelector("natural-tab-button");
      if (firstButton) {
        firstButton.classList.add("active");
        firstButton.setAttribute("aria-selected", "true");
      }
      firstPanel.classList.add("active");
    }
    header.addEventListener("click", (event) => {
      const button = event.target.closest("natural-tab-button");
      if (!button) {
        return;
      }
      const targetId = button.getAttribute("data-tab-target");
      header.querySelectorAll("natural-tab-button").forEach((btn) => {
        const isActive = btn === button;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-selected", String(isActive));
      });
      tabs.querySelectorAll("natural-tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === targetId);
      });
    });
  });
};

const hideDecorativeIcons = () => {
  const selectors = [
    'natural-layout i[class*="fa-"]:not([aria-hidden])',
    'natural-layout span.brand-icon:not([aria-hidden])',
    'natural-layout natural-divider:not([aria-hidden])',
  ];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.setAttribute("aria-hidden", "true");
    });
  });
};

const copyToClipboard = async (text) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.opacity = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const successful = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!successful) {
    throw new Error("copy-fallback failed");
  }
};

const initCopyButtons = () => {
  document
    .querySelectorAll("natural-content .code-panel button")
    .forEach((button) => {
      let timeoutId;
      const originalLabel = button.textContent?.trim() || "Copy";
      button.dataset.copyLabel = originalLabel;

      const resetState = () => {
        button.removeAttribute("data-copy-state");
        button.textContent = button.dataset.copyLabel;
      };

      const setState = (state) => {
        button.setAttribute("data-copy-state", state);
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
        timeoutId = window.setTimeout(resetState, 2000);
        button.textContent = state === "copied" ? "Copied" : button.dataset.copyLabel;
      };

      button.addEventListener("click", async () => {
        const panel = button.closest(".code-panel");
        const codeElement = panel?.querySelector("pre");
        const text = codeElement?.textContent?.trim();
        if (!text) {
          return;
        }
        try {
          await copyToClipboard(text);
          setState("copied");
        } catch (error) {
          setState("error");
        }
      });
    });
};

const initialize = () => {
  initNavExpandables();
  initSubjectSelector();
  hideDecorativeIcons();
  initTabs();
  initCopyButtons();
};

document.addEventListener("DOMContentLoaded", initialize);
