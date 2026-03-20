import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft } from "@fortawesome/free-solid-svg-icons";

export const SectionTitle = ({
	id,
	className,
	children,
	onBack,
}: {
	id?: string;
	className?: string;
	children: React.ReactNode;
	onBack?: () => void;
}) => {
	if (onBack) {
		return (
			<div className="relative flex items-center justify-center">
				<button
					onClick={onBack}
					className="absolute left-0 top-1/2 -translate-y-1/2 p-1 text-text-muted2 hover:text-text-title transition-colors"
				>
					<FontAwesomeIcon icon={faChevronLeft} className="w-5 h-5" />
				</button>
				<div
					id={id}
					className={`${className} mb-1 text-[1.75rem] sm:mb-5 sm:text-[1.625rem] font-black leading-[1.625rem] tracking-tight`}
				>
					{children}
				</div>
			</div>
		);
	}

	return (
		<div id={id} className={`${className} mb-1 text-[1.75rem] sm:mb-5 sm:text-[1.625rem] font-black leading-[1.625rem] tracking-tight`}>
			{children}
		</div>
	);
};
