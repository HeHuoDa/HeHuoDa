<script lang="ts">
// 仅 H5：真正的 a 保留键盘、上下文菜单和安全新窗口关系属性。
import { defineComponent, h } from "vue";
export default defineComponent({
  props: {
    href: { type: String, required: true },
    title: { type: String, default: "" },
  },
  setup(props, { slots }) {
    return () =>
      h(
        "a",
        {
          href: props.href,
          title: props.title,
          target: "_blank",
          rel: "noopener noreferrer",
        },
        slots.default?.(),
      );
  },
});
</script>
