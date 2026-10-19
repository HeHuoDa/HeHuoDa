<script lang="ts">
// 仅 H5 加载。render 保留真实 select/date/time，避免 uni-input 将日期类型降为文本。
import { defineComponent, h, nextTick, ref, watch } from "vue";
import type { PropType } from "vue";
export default defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: String, required: true },
    mode: {
      type: String as PropType<"selector" | "date" | "time">,
      required: true,
    },
    options: {
      type: Array as PropType<{ value: string; label: string }[]>,
      required: true,
    },
    placeholder: { type: String, default: "请选择" },
    disabled: Boolean,
    focus: Boolean,
  },
  emits: ["change"],
  setup(props, { attrs, emit }) {
    const control = ref<HTMLInputElement | HTMLSelectElement>();
    watch(
      () => props.focus,
      async (value) => {
        if (value) {
          await nextTick();
          control.value?.focus();
        }
      },
      { immediate: true },
    );
    return () =>
      h(
        props.mode === "selector" ? "select" : "input",
        {
          ...attrs,
          ref: control,
          type: props.mode === "selector" ? undefined : props.mode,
          value: props.modelValue,
          disabled: props.disabled,
          onChange: (event: Event) =>
            emit("change", (event.target as HTMLInputElement).value),
        },
        props.mode === "selector"
          ? [
              ...(props.options.some((item) => item.value === "")
                ? []
                : [
                    h(
                      "option",
                      { value: "", disabled: true },
                      props.placeholder,
                    ),
                  ]),
              ...props.options.map((item) =>
                h("option", { value: item.value }, item.label),
              ),
            ]
          : undefined,
      );
  },
});
</script>
