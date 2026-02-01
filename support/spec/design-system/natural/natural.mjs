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

const initialize = () => {
  initNavExpandables();
  initSubjectSelector();
};

document.addEventListener("DOMContentLoaded", initialize);
