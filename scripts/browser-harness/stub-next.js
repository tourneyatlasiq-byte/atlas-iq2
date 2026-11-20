import React from "react";
export default function Link({ href, children, ...rest }) { return React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children); }
export const usePathname = () => "/tournaments/t1/games/g1/track";
export const useSearchParams = () => new URLSearchParams();
export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {} });
