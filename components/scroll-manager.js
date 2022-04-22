import { html, Component } from "../lib/index.js";

let store = new Map();

export default class ScrollManager extends Component {
	constructor(props) {
		super(props);

		this.handleScroll = this.handleScroll.bind(this);
	}

	isAtBottom() {
		let target = this.props.target.current;
		return target.scrollTop >= target.scrollHeight - target.offsetHeight;
	}

	saveScrollPosition() {
		let target = this.props.target.current;

		let sticky = target.querySelectorAll(this.props.stickTo);
		let stickToKey = null;
		if (!this.isAtBottom()) {
			for (let i = 0; i < sticky.length; i++) {
				let el = sticky[i];
				if (el.offsetTop >= target.scrollTop + target.offsetTop) {
					stickToKey = el.dataset.key;
					break;
				}
			}
		}

		store.set(this.props.scrollKey, stickToKey);
	}

	restoreScrollPosition() {
		let target = this.props.target.current;
		if (!target.firstChild) {
			return;
		}

		let stickToKey = store.get(this.props.scrollKey);
		if (!stickToKey) {
			target.firstChild.scrollIntoView({ block: "end" });
		} else {
			let stickTo = target.querySelector("[data-key=\"" + stickToKey + "\"]");
			if (stickTo) {
				stickTo.scrollIntoView();
			}
		}

		if (target.scrollTop == 0) {
			this.props.onScrollTop();
		}
	}

	handleScroll() {
		if (this.props.target.current.scrollTop == 0) {
			this.props.onScrollTop();
		}
	}

	componentDidMount() {
		this.restoreScrollPosition();
		this.props.target.current.addEventListener("scroll", this.handleScroll);
	}

	componentWillReceiveProps(nextProps) {
		if (this.props.scrollKey !== nextProps.scrollKey || this.props.children !== nextProps.children) {
			this.saveScrollPosition();
		}
	}

	componentDidUpdate(prevProps) {
		if (!this.props.target.current) {
			return;
		}
		this.restoreScrollPosition();
	}

	componentWillUnmount() {
		this.props.target.current.removeEventListener("scroll", this.handleScroll);
		this.saveScrollPosition();
	}

	render() {
		return this.props.children;
	}
}
