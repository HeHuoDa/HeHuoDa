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
    <h2 id="management-dialog-title" class="mb-4 font-serif text-xl">
      {{ title }}
    </h2>
    <slot />
    <button
      type="button"
      class="hhr-button hhr-button--secondary mt-4"
      @click="emit('close')"
    >
      取消并关闭
    </button>
  </dialog>
</template>
<style scoped>
.management-dialog {
  margin: auto;
  width: calc(100% - 32px);
  max-width: 640px;
  max-height: calc(100dvh - 32px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--hhr-color-line);
  border-radius: var(--hhr-radius-panel);
  background: var(--hhr-color-surface);
  color: var(--hhr-color-ink);
}
.management-dialog::backdrop {
  background: rgb(24 62 48 / 35%);
}
</style>
