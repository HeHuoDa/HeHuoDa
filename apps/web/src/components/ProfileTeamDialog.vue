<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const previous = document.activeElement as HTMLElement | null;
onMounted(async () => {
  await nextTick();
  dialog.value?.showModal();
  dialog.value
    ?.querySelector<HTMLElement>("input, select, textarea, button")
    ?.focus();
});
onUnmounted(() => {
  dialog.value?.close();
  if (previous?.isConnected) previous.focus();
  else document.getElementById("student-content")?.focus();
});
function trap(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const controls = dialog.value?.querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
  );
  if (!controls?.length) return;
  const first = controls[0]!,
    last = controls[controls.length - 1]!;
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === dialog.value)
  ) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>
<template>
  <dialog
    ref="dialog"
    class="management-dialog"
    aria-labelledby="management-dialog-title"
    @cancel.prevent="emit('close')"
    @keydown="trap"
  >
    <div class="management-dialog-layout">
      <header class="management-dialog-heading">
        <h2 id="management-dialog-title" class="font-serif text-xl">
          {{ title }}
        </h2>
      </header>
      <div class="management-dialog-body"><slot /></div>
      <footer class="management-dialog-actions">
        <slot name="actions" />
        <button
          type="button"
          class="hhr-button hhr-button--secondary"
          @click="emit('close')"
        >
          取消并关闭
        </button>
      </footer>
    </div>
  </dialog>
</template>
<style scoped>
.management-dialog {
  margin: auto;
  width: calc(100% - 32px);
  max-width: 640px;
  max-height: calc(100dvh - 32px);
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-panel);
  background: var(--hhr-color-surface);
  color: var(--hhr-color-ink);
}
.management-dialog-layout {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 34px);
}
.management-dialog-heading,
.management-dialog-actions {
  flex-shrink: 0;
  padding: 16px 24px;
}
.management-dialog-heading {
  border-bottom: 1px solid var(--hhr-color-line);
}
.management-dialog-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 24px;
}
.management-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  border-top: 1px solid var(--hhr-color-line);
  padding-bottom: max(16px, env(safe-area-inset-bottom));
}
@media (max-width: 600px) {
  .management-dialog-heading,
  .management-dialog-body,
  .management-dialog-actions {
    padding-inline: 16px;
  }
  .management-dialog-actions :deep(button) {
    flex: 1;
  }
}
.management-dialog::backdrop {
  background: rgb(24 62 48 / 35%);
}
</style>
