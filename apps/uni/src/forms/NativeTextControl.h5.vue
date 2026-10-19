<script lang="ts">
// H5 真实输入元素：标签、错误关联、自动填充和焦点落在控件本身。
import { defineComponent, h, nextTick, ref, watch } from "vue";
export default defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: String, required: true },
    multiline: Boolean,
    password: Boolean,
    type: { type: String, default: "text" },
    focus: Boolean,
    disabled: Boolean,
    maxlength: { type: Number, default: -1 },
  },
  emits: ["input", "focus", "blur", "confirm"],
  setup(props, { attrs, emit }) {
    const control = ref<HTMLInputElement | HTMLTextAreaElement>();
    watch(
      () => props.focus,
      async (value) => {
        await nextTick();
        if (value) control.value?.focus();
      },
      { immediate: true },
    );
    const valueEvent = (event: Event) => ({
      detail: { value: (event.target as HTMLInputElement).value },
    });
    return () =>
      h(props.multiline ? "textarea" : "input", {
        ...attrs,
        ref: control,
        type: props.password ? "password" : props.type,
        value: props.modelValue,
        disabled: props.disabled,
        maxlength: props.maxlength < 0 ? undefined : props.maxlength,
        onInput: (event: Event) => emit("input", valueEvent(event)),
        onFocus: () => emit("focus"),
        onBlur: (event: Event) => emit("blur", valueEvent(event)),
        onKeydown: (event: KeyboardEvent) => {
          if (event.key === "Enter" && !props.multiline && !event.isComposing)
            emit("confirm");
        },
      });
  },
});
</script>
